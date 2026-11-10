/**
 * Copy text to the clipboard. Accepts a promise so a copy can be started inside the tap handler
 * (browsers only allow clipboard writes during a tap) and filled in once an async step, such as
 * pushing to production, has finished. Resolves false if the copy was blocked or the promise rejected.
 */
export async function copyText(text: string | Promise<string>): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      const blob = Promise.resolve(text).then((t) => new Blob([t], { type: 'text/plain' }))
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })])
      return true
    }
    const t = await text
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(t)
      return true
    }
  } catch {
    // blocked by the browser, or the promise was rejected: report failure below
  }
  return false
}
