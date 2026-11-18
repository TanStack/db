// Bundled dependencies must survive npm packing, which omits node_modules.
// Preserve the bundler's normal filename cleanup, including virtual module IDs.
/** @param {string} name */
function publishableModuleName(name) {
  const drive = /^[a-z]:/i.exec(name)?.[0] ?? ``
  const relative = name
    .slice(drive.length)
    .replace(/[\p{Cc}"#$%&*+,:;<=>?[\]^`{|}]/gu, `_`)
    .replaceAll(`node_modules`, `vendor`)
  return drive + relative
}

export const publishableModuleOutput = {
  preserveModulesRoot: `src`,
  sanitizeFileName: publishableModuleName,
}
