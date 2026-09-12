/**
 * Où trouver Chromium.
 *
 * `CHROMIUM` le désigne explicitement ; sinon on laisse Playwright chercher dans
 * son installation habituelle. Le chemin n'est jamais écrit en dur dans un
 * script : il change d'une machine à l'autre, et un audit qu'on ne peut pas
 * lancer ailleurs ne sert à personne.
 */
export function optionsNavigateur() {
  const chemin = process.env.CHROMIUM
  return { args: ['--no-sandbox'], ...(chemin ? { executablePath: chemin } : {}) }
}
