import { exportJWK, exportPKCS8, generateKeyPair } from 'jose'

/** Ephemeral keys only, passed to the isolated backend's environment setup. */
export async function authEnvironment(): Promise<Record<string, string>> {
  const { privateKey, publicKey } = await generateKeyPair(`RS256`)
  return {
    JWT_PRIVATE_KEY: (await exportPKCS8(privateKey)).trimEnd(),
    JWKS: JSON.stringify({
      keys: [{ use: `sig`, ...(await exportJWK(publicKey)) }],
    }),
    SITE_URL: `http://127.0.0.1:3000`,
  }
}
