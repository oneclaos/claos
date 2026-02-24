/**
 * Mock for write-file-atomic
 *
 * When tests mock 'fs', the real write-file-atomic fails because
 * it uses fs.openSync internally. This mock redirects to fs.writeFileSync
 * which is properly mocked in tests.
 */

import { writeFileSync, type WriteFileOptions } from 'fs'

interface WriteOptions {
  mode?: number
  encoding?: BufferEncoding
  fsync?: boolean
}

// Async version
function writeFileAtomic(
  filename: string,
  data: string | Buffer,
  options?: WriteOptions
): Promise<void> {
  return new Promise((resolve) => {
    writeFileSync(filename, data, options as WriteFileOptions)
    resolve()
  })
}

// Sync version
writeFileAtomic.sync = function (
  filename: string,
  data: string | Buffer,
  options?: WriteOptions
): void {
  writeFileSync(filename, data, options as WriteFileOptions)
}

export default writeFileAtomic
module.exports = writeFileAtomic
module.exports.default = writeFileAtomic
