import { dialog } from 'electron'
import { Socket } from 'node:net'

/**
 * Imported first by the main process, so nothing in the network stack can freeze the Mac.
 *
 * Sync's realtime socket runs on Node's own HTTP client (undici), which calls
 * `socket.setTypeOfService` as it writes a request. On macOS that throws for a socket
 * the server has just reset, from a callback nothing can catch, and Electron answers an
 * uncaught exception with a blocking alert. Node already treats the call as best-effort
 * on Windows; do the same here. Cue never sets a type of service itself.
 */
const sockets = Socket.prototype as unknown as { setTypeOfService?: (this: Socket, tos: number) => Socket }
const setTypeOfService = sockets.setTypeOfService
if (setTypeOfService) {
  sockets.setTypeOfService = function (tos) {
    try {
      return setTypeOfService.call(this, tos)
    } catch {
      return this
    }
  }
}

// Anything else from the network stack is logged, and sync recovers on its own retries.
// Other errors still get Electron's alert, as before.
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception in the main process', error)
  const stack = error?.stack ?? String(error)
  if (!/undici|realtime|websocket|supabase/i.test(stack)) {
    dialog.showErrorBox('A JavaScript error occurred in the main process', `Uncaught Exception:\n${stack}`)
  }
})
process.on('unhandledRejection', (reason) => console.error('Unhandled rejection in the main process', reason))
