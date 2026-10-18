import ExpoModulesCore
import UIKit

/**
 Two small things React Native can't do on its own:

 - Put the caret exactly where a line was tapped. Lines that aren't being edited don't
   take touches (so a long press can pick them up), so the tap is forwarded here and the
   text view becomes first responder with the caret at the closest character.
 - Keep running for a few seconds after Cue leaves the screen, so the last edits finish
   uploading before iOS suspends the app.
 */
public class CueNativeModule: Module {
  private var backgroundTasks: [Int: UIBackgroundTaskIdentifier] = [:]
  private var nextTaskId = 1

  public func definition() -> ModuleDefinition {
    Name("CueNative")

    /// Focuses the text input inside `view` with the caret nearest to a point in window
    /// coordinates. Returns the caret's offset, or -1 if there's no text input there.
    AsyncFunction("focusAt") { (view: UIView, x: Double, y: Double) -> Int in
      guard let input = findTextInput(in: view) else { return -1 }
      let point = input.convert(CGPoint(x: x, y: y), from: nil)
      let position = input.closestPosition(to: point) ?? input.endOfDocument
      if !input.isFirstResponder {
        input.becomeFirstResponder()
      }
      input.selectedTextRange = input.textRange(from: position, to: position)
      return input.offset(from: input.beginningOfDocument, to: position)
    }.runOnQueue(.main)

    AsyncFunction("beginBackgroundTask") { () -> Int in
      let id = self.nextTaskId
      self.nextTaskId += 1
      var task = UIBackgroundTaskIdentifier.invalid
      task = UIApplication.shared.beginBackgroundTask(withName: "Cue sync") { [weak self] in
        UIApplication.shared.endBackgroundTask(task)
        self?.backgroundTasks[id] = nil
      }
      self.backgroundTasks[id] = task
      return id
    }.runOnQueue(.main)

    AsyncFunction("endBackgroundTask") { (id: Int) in
      if let task = self.backgroundTasks.removeValue(forKey: id) {
        UIApplication.shared.endBackgroundTask(task)
      }
    }.runOnQueue(.main)
  }
}

private typealias TextInputView = UIView & UITextInput

private func findTextInput(in view: UIView) -> TextInputView? {
  if let input = view as? UITextView { return input }
  if let input = view as? UITextField { return input }
  for subview in view.subviews {
    if let input = findTextInput(in: subview) { return input }
  }
  return nil
}
