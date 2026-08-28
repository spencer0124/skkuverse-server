/**
 * "Which layer set is live, and is its config usable?" — the one answer both
 * `/map/config` and `/map/markers/event` read.
 *
 * The cases worth having are the two that are NOT "no festival today": an
 * activation naming a layer set this build has no file for, and one whose file
 * failed validation. Both must answer null without failing the request, and
 * both must say so in the log exactly once — a warn per request at the map's
 * rate limit would bury the one line that matters.
 */
const mockLogger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
jest.mock("../../../src/infra/logger", () => mockLogger);

jest.mock("../../../src/eventmap/eventmap.data", () => ({
  findActiveActivation: jest.fn(),
}));

const actualConfigModule = jest.requireActual("../../../src/eventmap/eventmap.config");
const getLayerSetConfig = jest.fn(actualConfigModule.getLayerSetConfig);
jest.mock("../../../src/eventmap/eventmap.config", () => ({
  ...actualConfigModule,
  getLayerSetConfig: (...args: unknown[]) => getLayerSetConfig(...args),
}));

import { activeEventConfig } from "../../../src/eventmap/eventmap.active";
import { findActiveActivation } from "../../../src/eventmap/eventmap.data";

const NOW = new Date("2026-09-16T09:00:00.000Z");
const mockFindActiveActivation = findActiveActivation as jest.MockedFunction<
  typeof findActiveActivation
>;
const activation = (id: string) =>
  ({ _id: id }) as Awaited<ReturnType<typeof findActiveActivation>>;

beforeEach(() => {
  jest.clearAllMocks();
  getLayerSetConfig.mockImplementation(actualConfigModule.getLayerSetConfig);
});

describe("activeEventConfig", () => {
  it("is null when no activation is live, and says nothing", async () => {
    mockFindActiveActivation.mockResolvedValue(null);
    await expect(activeEventConfig(NOW)).resolves.toBeNull();
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("returns the loaded config for a live layer set this build knows", async () => {
    mockFindActiveActivation.mockResolvedValue(activation("eskara-2026"));
    const config = await activeEventConfig(NOW);
    expect(config?.layerSetId).toBe("eskara-2026");
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it("is null for a layer set with no config file, warning ONCE per process", async () => {
    mockFindActiveActivation.mockResolvedValue(activation("eskara-2099"));

    await expect(activeEventConfig(NOW)).resolves.toBeNull();
    await expect(activeEventConfig(NOW)).resolves.toBeNull();
    await expect(activeEventConfig(NOW)).resolves.toBeNull();

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn.mock.calls[0]![0]).toMatch(
      /activation "eskara-2099" is live but this build has no config for it/,
    );
  });

  it("is null for a layer set whose config was rejected, naming the rejection", async () => {
    mockFindActiveActivation.mockResolvedValue(activation("eskara-2077"));
    getLayerSetConfig.mockReturnValue({
      config: null,
      configHash: null,
      error: 'config.itemDefaults.fallback.layerId "nope" is not in config.layers',
    });

    await expect(activeEventConfig(NOW)).resolves.toBeNull();
    await expect(activeEventConfig(NOW)).resolves.toBeNull();

    expect(mockLogger.warn).toHaveBeenCalledTimes(1);
    expect(mockLogger.warn.mock.calls[0]![0]).toMatch(/its config was rejected: .*layerId "nope"/);
  });
});
