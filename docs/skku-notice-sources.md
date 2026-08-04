---
title: 공지 크롤링 소스 목록 (snapshot · 폐기)
type: reference
status: deprecated
owner: zoyoong124@gmail.com
last-updated: 2026-07-24
audience: internal
---

# 성균관대학교 공지사항 크롤링 소스 목록 (snapshot)

> [!WARNING]
> **이 문서는 폐기됐다.** 2026-03-29 시점 148-소스 스냅샷(전체 목록·유형 분류·URL 검증·구현 상태)을 담고 있었으나, 서버가 stale한 소스 목록을 vendor하는 중복이었다. 전체 원문은 git 히스토리에 보존한다. 현재 진실은 아래 SSOT를 본다.

소스 목록·스키마·전략은 각 소유처가 canonical이다 (값 복사 금지 → [docs/README.md §3](README.md)):

| 알고 싶은 것 | 어디를 보나 |
| --- | --- |
| 서버가 실제 쓰는 소스 목록 (런타임 SSOT) | [`../src/notices/sources.json`](../src/notices/sources.json) |
| 크롤러 학과 config SSOT (strategy·selector·baseUrl) | [crawler `sources.json`](https://github.com/spencer0124/skkuverse-crawler/blob/main/sources.json) (레포 루트) |
| 학과 커버리지 (캠퍼스·단과대별 표) | [crawler coverage](https://github.com/spencer0124/skkuverse-crawler/blob/main/docs/reference/coverage/department-coverage-analysis.md) (codegen 생성) |
| 전략별 필드 가용성·특이사항 | [crawler notices-data-contract §3](https://github.com/spencer0124/skkuverse-crawler/blob/main/docs/reference/notices-data-contract.md) |

전체 문서 인덱스는 [docs/README.md](README.md).
