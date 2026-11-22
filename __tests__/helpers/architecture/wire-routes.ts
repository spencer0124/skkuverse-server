/**
 * What a route declares it sends, read from its handler's return type (ADR
 * 0010, D13): the types inside `Promise<…>`, both parts of `WithMeta<T, M>`,
 * and the `.wire` names they reference. Shared by the wire-routes rule, which
 * requires a wire type, and the contract export, which lists the routes each
 * wire schema describes in `contracts/produced/index.json`.
 */
import ts from "typescript";
import { importsOf, resolveRelative } from "./ast";
import { routeHandlersIn, type RouteHandler } from "./routes";

/** A name a route's type takes from a `.wire` file. */
export interface WireTypeRef {
  /** Repo-relative path of the `.wire.ts` file, or the bare specifier when it is not relative. */
  wireFile: string;
  /** What that file exports under the name: a schema, or one of its `z.input` aliases. */
  name: string;
}

export interface RouteWireRefs {
  /** `<METHOD> <path>`, as the wire-routes rule reports it. */
  route: string;
  refs: WireTypeRef[];
}

interface WireBinding {
  wireFile: string;
  /** The exported name, or null for a namespace import. */
  imported: string | null;
}

const isWireSpecifier = (specifier: string) => /\.wire$/.test(specifier);

export const isExemptPath = (routePath: string) =>
  routePath === "health" || routePath.startsWith("health/") || routePath.startsWith("internal/");

function resolveWire(file: string, specifier: string): string {
  if (!specifier.startsWith(".")) return specifier;
  return `${resolveRelative(file, specifier) ?? specifier}.ts`;
}

/** The local names a file binds from `.wire` imports: named, default and namespace. */
function wireBindings(sf: ts.SourceFile): Map<string, WireBinding> {
  const bindings = new Map<string, WireBinding>();
  for (const i of importsOf(sf)) {
    if (i.kind !== "import" || !isWireSpecifier(i.specifier)) continue;
    bindings.set(i.local, { wireFile: resolveWire(sf.fileName, i.specifier), imported: i.imported === "*" ? null : i.imported });
  }
  return bindings;
}

const identifiersOf = (name: ts.EntityName): string[] =>
  ts.isIdentifier(name) ? [name.text] : [...identifiersOf(name.left), name.right.text];

function refOf(name: ts.EntityName, bindings: ReadonlyMap<string, WireBinding>): WireTypeRef | undefined {
  const [first, second] = identifiersOf(name);
  const binding = bindings.get(first!);
  if (!binding) return undefined;
  if (binding.imported !== null) return { wireFile: binding.wireFile, name: binding.imported };
  return second === undefined ? undefined : { wireFile: binding.wireFile, name: second };
}

/** Every wire name a type references at any depth: `X`, `Wire.X`, `X[]`, `X | null`, `typeof x`, `import("./x.wire").X`. */
function wireTypeRefs(type: ts.Node, bindings: ReadonlyMap<string, WireBinding>): WireTypeRef[] {
  const refs: WireTypeRef[] = [];
  const visit = (node: ts.Node): void => {
    let ref: WireTypeRef | undefined;
    if (ts.isTypeReferenceNode(node)) ref = refOf(node.typeName, bindings);
    else if (ts.isTypeQueryNode(node)) ref = refOf(node.exprName, bindings);
    else if (
      ts.isImportTypeNode(node) &&
      node.qualifier &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteral(node.argument.literal) &&
      isWireSpecifier(node.argument.literal.text)
    ) {
      ref = {
        wireFile: resolveWire(node.getSourceFile().fileName, node.argument.literal.text),
        name: identifiersOf(node.qualifier)[0]!,
      };
    }
    if (ref) refs.push(ref);
    ts.forEachChild(node, visit);
  };
  visit(type);
  return refs;
}

const isReference = (type: ts.TypeNode | undefined, name: string): type is ts.TypeReferenceNode =>
  !!type && ts.isTypeReferenceNode(type) && ts.isIdentifier(type.typeName) && type.typeName.text === name;

/** The types that declare what a handler sends: `T` and `M` of `WithMeta<T, M>`, else the return type, inside `Promise`. */
function payloadTypes(handler: ts.MethodDeclaration): Array<ts.TypeNode | undefined> {
  let type = handler.type;
  if (isReference(type, "Promise")) type = type.typeArguments?.[0];
  if (isReference(type, "WithMeta")) return [type.typeArguments?.[0], type.typeArguments?.[1]];
  return [type];
}

const decoratorNamed = (node: ts.HasDecorators, name: string): ts.CallExpression | undefined =>
  (ts.getDecorators(node) ?? [])
    .map((d) => d.expression)
    .find((e): e is ts.CallExpression => ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === name);

function callsSendSuccess(node: ts.Node): boolean {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "sendSuccess") return true;
  return ts.forEachChild(node, (child) => callsSendSuccess(child) || undefined) ?? false;
}

function writesOwnResponse(handler: ts.MethodDeclaration): boolean {
  const res = handler.parameters.map((p) => decoratorNamed(p, "Res") ?? decoratorNamed(p, "Response")).find(Boolean);
  if (!res || res.arguments.length > 0) return false;
  return !handler.body || !callsSendSuccess(handler.body);
}

/** A handler whose payload is a `StreamableFile`: Nest writes it as a file with its own content type, never the envelope. */
const returnsFile = (handler: ts.MethodDeclaration): boolean => payloadTypes(handler).every((type) => isReference(type, "StreamableFile"));

const routeName = (r: RouteHandler) => `${r.method} ${r.path}`;

/** The routes in one file that serve JSON to a client: not internal, not health, not a raw response or a file. */
export function clientRoutes(file: string, source: string): RouteHandler[] {
  return routeHandlersIn(file, source).filter((r) => !isExemptPath(r.path) && !writesOwnResponse(r.handler) && !returnsFile(r.handler));
}

/** `<METHOD> <path>` for each client-facing route whose payload type, or `meta` type, names no `.wire` type. */
export function unwiredRoutes(file: string, source: string): string[] {
  return clientRoutes(file, source)
    .filter((r) => {
      const bindings = wireBindings(r.handler.getSourceFile());
      return !payloadTypes(r.handler).every((type) => type !== undefined && wireTypeRefs(type, bindings).length > 0);
    })
    .map(routeName);
}

/** Every route in one file, exempt or not, with the wire names its payload types reference. */
export function routeWireRefs(file: string, source: string): RouteWireRefs[] {
  return routeHandlersIn(file, source).map((r) => {
    const bindings = wireBindings(r.handler.getSourceFile());
    const types = payloadTypes(r.handler).filter((type): type is ts.TypeNode => type !== undefined);
    return { route: routeName(r), refs: types.flatMap((type) => wireTypeRefs(type, bindings)) };
  });
}
