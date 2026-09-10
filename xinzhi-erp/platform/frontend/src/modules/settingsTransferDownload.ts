export function saveSettingsTransferResult(filename: string, mediaType: string, contentBase64: string) {
  const bytes = Uint8Array.from(atob(contentBase64), (character) => character.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: mediaType }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
