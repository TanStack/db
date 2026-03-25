declare module '@journeyapps/wa-sqlite/src/examples/OPFSCoopSyncVFS.js' {
  export class OPFSCoopSyncVFS {
    static create(
      name: string,
      module: unknown,
    ): Promise<{
      close?: () => Promise<void> | void
    }>
  }
}
