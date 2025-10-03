function readPackage(pkg, context) {
  // Force all @tanstack/db dependencies to resolve to workspace version
  if (pkg.dependencies && pkg.dependencies["@tanstack/db"]) {
    pkg.dependencies["@tanstack/db"] = "workspace:*"
    context.log(`Overriding @tanstack/db dependency in ${pkg.name}`)
  }

  if (pkg.devDependencies && pkg.devDependencies["@tanstack/db"]) {
    pkg.devDependencies["@tanstack/db"] = "workspace:*"
    context.log(`Overriding @tanstack/db devDependency in ${pkg.name}`)
  }

  if (pkg.peerDependencies && pkg.peerDependencies["@tanstack/db"]) {
    pkg.peerDependencies["@tanstack/db"] = "workspace:*"
    context.log(`Overriding @tanstack/db peerDependency in ${pkg.name}`)
  }

  return pkg
}

module.exports = {
  hooks: {
    readPackage,
  },
}
