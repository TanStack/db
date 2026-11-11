// The oracleProperty ids that the declareOracle removal adds for the
// "sqlite" conversion group, and their replay owners. Only that group's branch
// edits this file, so parallel groups do not conflict in oracle-config.ts
// or oracle-replay-manifest.ts. Integration folds both lists into those
// files and deletes this directory.
import type { ConvertedOwnerGroup } from './index.js'

export const properties: ReadonlyArray<string> = [
  `opfs.open-outcome`,
  `electron.ipc-readiness`,
  `electron.follower-settlement`,
  `sqlite-reload.class.electron-app`,
  `sqlite-persistence.typed-value-reopen`,
  `sqlite-persistence.native-temporal-query`,
  `persisted-demand-coverage.cell`,
  `persisted-demand-coverage.lifecycle`,
  `persisted-demand-coverage.joined`,
  `persisted-demand-coverage.session-reset`,
  `persisted-demand-coverage.bookkeeping`,
  `persisted-demand-coverage.window`,
  `persisted-demand-coverage.next-page`,
  `browser.shared-driver-fairness.neutral`,
  `browser.shared-driver-fairness.persist-storm`,
  `browser.shared-driver-fairness.persist-first`,
  `browser.shared-driver-fairness.barrier`,
  `browser.multi-tab-refetch-storm`,
  `browser.multi-tab-reserved-history-fixed`,
  `sqlite-ordinary.native-values`,
  `sqlite-ordinary.write-history-fixed`,
  `sqlite-ordinary.independent-work-fixed`,
  `sqlite-ordinary.fixed-cases`,
  `sqlite-ordinary.metadata-discarding-writer`,
  `sqlite-ordinary.low-call-replacement`,
  `sqlite-ordinary.idempotent-position`,
  `sqlite-ordinary.late-bookkeeping-fault`,
  `sqlite-ordinary.later-row-write-fault`,
  `browser-coordinator.subset-wire`,
  `browser-coordinator.subset-ack`,
  `browser-coordinator.collection-scoped-lease`,
  `browser-coordinator.remote-lease-takeover`,
  `browser-coordinator.adapter-isolation`,
  `browser-coordinator.fresh-init`,
  `browser-coordinator.write-ownership`,
  `browser-coordinator.real-tab-follower`,
]

export const owners: ReadonlyArray<ConvertedOwnerGroup> = [
  [
    `browser-db-sqlite-persistence/tests/opfs-open-outcome-oracle.test.ts`,
    `opfs`,
    `open-outcome`,
  ],
  [
    `electron-db-sqlite-persistence/tests/electron-ipc-readiness-oracle.test.ts`,
    `electron`,
    `ipc-readiness follower-settlement`,
  ],
  [
    `electron-db-sqlite-persistence/tests/reload-class-oracle.electron.e2e.test.ts`,
    `sqlite-reload`,
    `class.electron-app`,
  ],
  [
    `db-sqlite-persistence-core/tests/sqlite-temporal-value-oracle.test.ts`,
    `sqlite-persistence`,
    `typed-value-reopen native-temporal-query`,
  ],
  [
    `db-sqlite-persistence-core/tests/persisted-demand-coverage-oracle.test.ts`,
    `persisted-demand-coverage`,
    `cell lifecycle joined session-reset bookkeeping window next-page`,
  ],
  [
    `browser-db-sqlite-persistence/tests/shared-driver-fairness-oracle.test.ts`,
    `browser.shared-driver-fairness`,
    `neutral persist-storm persist-first barrier`,
  ],
  [
    `browser-db-sqlite-persistence/tests/multi-tab-electric-oracle.test.ts`,
    `browser`,
    `multi-tab-refetch-storm multi-tab-reserved-history-fixed`,
  ],
  [
    `db-sqlite-persistence-core/tests/sqlite-resume-snapshot-oracle.test.ts`,
    `sqlite-ordinary`,
    `native-values write-history-fixed independent-work-fixed fixed-cases metadata-discarding-writer low-call-replacement idempotent-position late-bookkeeping-fault later-row-write-fault`,
    `db-sqlite-persistence-core/tests/ordinary-transaction-work-oracle.ts`,
  ],
  [
    `browser-db-sqlite-persistence/tests/per-collection-coordinator-oracle.test.ts`,
    `browser-coordinator`,
    `subset-wire subset-ack collection-scoped-lease remote-lease-takeover adapter-isolation fresh-init write-ownership real-tab-follower`,
  ],
]
