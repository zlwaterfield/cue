import UIKit
import UniformTypeIdentifiers

/**
 Cue in the share sheet. Sharing a link (or some text) adds it to today as a new line.

 The extension can't reach the notes or the sync server itself, so it leaves what was
 shared in the app group's inbox, one small JSON file each, and Cue adds it to
 today the next time it comes to the screen. The sheet is only a confirmation: no compose
 step, no buttons. It says "Added to Today" and goes.
 */
class ShareViewController: UIViewController {
  private let card = UIVisualEffectView(effect: UIBlurEffect(style: .systemThickMaterial))
  private var finished = false

  override init(nibName: String?, bundle: Bundle?) {
    super.init(nibName: nibName, bundle: bundle)
    // Over the app being shared from, not in a sheet.
    modalPresentationStyle = .overFullScreen
  }

  required init?(coder: NSCoder) {
    super.init(coder: coder)
    modalPresentationStyle = .overFullScreen
  }

  override func viewWillAppear(_ animated: Bool) {
    super.viewWillAppear(animated)
    // The views hosting this one are opaque; cleared, only the card shows, over the share
    // sheet, rather than an empty sheet around it.
    var ancestor = view.superview
    while let v = ancestor {
      v.backgroundColor = .clear
      ancestor = v.superview
    }
    view.window?.backgroundColor = .clear
  }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .clear
    card.alpha = 0
    Task { await receive() }
  }

  override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    finish()
  }

  private func receive() async {
    let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
    let providers = items.flatMap { $0.attachments ?? [] }
    var text: String?
    if let url = await firstWebURL(providers) {
      text = url.absoluteString
    } else if let shared = await firstText(providers) ?? items.compactMap({ $0.attributedContentText?.string }).first {
      text = shared.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    guard let text, !text.isEmpty else {
      show(title: "Nothing to add", detail: "Cue can add links and text.", ok: false)
      return
    }
    do {
      try Inbox.add(text)
      show(title: "Added to Today", detail: Self.detail(for: text), ok: true)
    } catch {
      show(title: "Couldn’t add to Cue", detail: "Open Cue and try again.", ok: false)
    }
  }

  private func firstWebURL(_ providers: [NSItemProvider]) async -> URL? {
    for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
      if let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL,
         let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" {
        return url
      }
    }
    return nil
  }

  private func firstText(_ providers: [NSItemProvider]) async -> String? {
    for provider in providers where provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
      if let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String {
        return text
      }
    }
    return nil
  }

  /// The link's host, or the first line of the text.
  private static func detail(for text: String) -> String {
    if !text.contains(where: \.isWhitespace), let url = URL(string: text), let host = url.host {
      return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }
    return text.split(whereSeparator: \.isNewline).first.map(String.init) ?? text
  }

  /* ------------------------------------------------------------------ Card */

  private func show(title: String, detail: String, ok: Bool) {
    card.layer.cornerRadius = 18
    card.layer.cornerCurve = .continuous
    card.clipsToBounds = true
    card.translatesAutoresizingMaskIntoConstraints = false

    let icon = UIImageView(image: UIImage(systemName: ok ? "checkmark.circle.fill" : "exclamationmark.circle.fill"))
    icon.tintColor = .label
    icon.preferredSymbolConfiguration = UIImage.SymbolConfiguration(pointSize: 22, weight: .medium)
    icon.setContentHuggingPriority(.required, for: .horizontal)

    let heading = UILabel()
    heading.text = title
    heading.font = .systemFont(ofSize: 16, weight: .semibold)
    heading.textColor = .label

    let sub = UILabel()
    sub.text = detail
    sub.font = .systemFont(ofSize: 14)
    sub.textColor = .secondaryLabel
    sub.lineBreakMode = .byTruncatingTail

    let labels = UIStackView(arrangedSubviews: [heading, sub])
    labels.axis = .vertical
    labels.spacing = 2
    let row = UIStackView(arrangedSubviews: [icon, labels])
    row.alignment = .center
    row.spacing = 12
    row.translatesAutoresizingMaskIntoConstraints = false
    card.contentView.addSubview(row)
    view.addSubview(card)

    NSLayoutConstraint.activate([
      row.leadingAnchor.constraint(equalTo: card.contentView.leadingAnchor, constant: 18),
      row.trailingAnchor.constraint(equalTo: card.contentView.trailingAnchor, constant: -20),
      row.topAnchor.constraint(equalTo: card.contentView.topAnchor, constant: 14),
      row.bottomAnchor.constraint(equalTo: card.contentView.bottomAnchor, constant: -14),
      card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      // A banner at the top, clear of the share sheet.
      card.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
      card.widthAnchor.constraint(lessThanOrEqualTo: view.widthAnchor, constant: -48),
      card.widthAnchor.constraint(greaterThanOrEqualToConstant: 220)
    ])

    card.accessibilityLabel = "\(title). \(detail)"
    card.isAccessibilityElement = true
    UIAccessibility.post(notification: .announcement, argument: title)
    if ok { UINotificationFeedbackGenerator().notificationOccurred(.success) }

    card.transform = CGAffineTransform(translationX: 0, y: -16).scaledBy(x: 0.96, y: 0.96)
    UIView.animate(withDuration: 0.32, delay: 0, usingSpringWithDamping: 0.85, initialSpringVelocity: 0) {
      self.card.alpha = 1
      self.card.transform = .identity
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + (ok ? 1.1 : 2.0)) { self.finish() }
  }

  private func finish() {
    guard !finished else { return }
    finished = true
    UIView.animate(withDuration: 0.18, animations: {
      self.card.alpha = 0
      self.card.transform = CGAffineTransform(translationX: 0, y: -8)
    }, completion: { _ in
      self.extensionContext?.completeRequest(returningItems: nil)
    })
  }
}

/// The app group's inbox, which Cue empties into the day when it comes to the screen.
enum Inbox {
  struct Unavailable: Error {}

  static func add(_ text: String) throws {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "CueAppGroup") as? String,
          let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    else { throw Unavailable() }
    let inbox = container.appendingPathComponent("Inbox", isDirectory: true)
    try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)
    let now = Date()
    let entry: [String: Any] = ["text": text, "at": Int(now.timeIntervalSince1970 * 1000)]
    let data = try JSONSerialization.data(withJSONObject: entry)
    let name = "\(Int(now.timeIntervalSince1970 * 1000))-\(UUID().uuidString).json"
    try data.write(to: inbox.appendingPathComponent(name), options: .atomic)
  }
}
