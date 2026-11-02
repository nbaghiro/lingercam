import ActivityKit
import SwiftUI
import WidgetKit

// Must match modules/live-activity/ios/LiveActivityModule.swift field for field.
struct LingerActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var left: String
        var progress: Double?
        var moments: String
        var reveal: String
        var closed: String
        var endsAt: Date
        var revealsAt: Date
    }

    var code: String
    var title: String
}

private enum Palette {
    static let card = Color(red: 18 / 255, green: 18 / 255, blue: 16 / 255)
    static let text = Color(red: 243 / 255, green: 241 / 255, blue: 236 / 255)
    static let muted = Color(red: 170 / 255, green: 167 / 255, blue: 159 / 255)
    static let candle = Color(red: 233 / 255, green: 201 / 255, blue: 154 / 255)
    static let track = Color(red: 51 / 255, green: 51 / 255, blue: 51 / 255)
    static let tile = Color(red: 247 / 255, green: 245 / 255, blue: 240 / 255)
    static let ink = Color(red: 18 / 255, green: 18 / 255, blue: 16 / 255)
}

private func serif(_ size: CGFloat) -> Font { .custom("NewsreaderDisplay-Regular", size: size) }
private func sans(_ size: CGFloat) -> Font { .custom("Pretendard-Regular", size: size) }

/// The two overlapping circles, drawn on the brand's 32 point grid.
struct Mark: View {
    var color: Color
    var size: CGFloat

    var body: some View {
        let unit = size / 32
        ZStack {
            Circle()
                .strokeBorder(color, lineWidth: 3 * unit)
                .frame(width: 21 * unit, height: 21 * unit)
                .offset(x: -4 * unit)
            Circle()
                .fill(color)
                .frame(width: 18 * unit, height: 18 * unit)
                .offset(x: 4 * unit)
        }
        .frame(width: size, height: size)
    }
}

struct MarkTile: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
            .fill(Palette.tile)
            .frame(width: 44, height: 44)
            .overlay(Mark(color: Palette.ink, size: 22))
    }
}

struct ShotsBar: View {
    var progress: Double

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(Palette.track)
                Capsule()
                    .fill(Palette.candle)
                    .frame(width: proxy.size.width * min(max(progress, 0), 1))
            }
        }
        .frame(height: 6)
    }
}

struct LockScreenCard: View {
    let context: ActivityViewContext<LingerActivityAttributes>

    var body: some View {
        let state = context.state
        VStack(alignment: .leading, spacing: 13) {
            HStack(spacing: 12) {
                MarkTile()
                VStack(alignment: .leading, spacing: 2) {
                    Text(context.attributes.title)
                        .font(serif(21))
                        .foregroundStyle(Palette.text)
                        .lineLimit(1)
                    Text(context.isStale ? state.closed : state.left)
                        .font(sans(14))
                        .foregroundStyle(Palette.muted)
                }
            }
            if let progress = state.progress, !context.isStale {
                ShotsBar(progress: progress)
            }
            HStack {
                Text(state.moments)
                Spacer()
                if !context.isStale { Text(state.reveal) }
            }
            .font(sans(14))
            .foregroundStyle(Palette.muted)
            .lineLimit(1)
        }
        .padding(18)
        .activityBackgroundTint(Palette.card.opacity(0.86))
        .activitySystemActionForegroundColor(Palette.text)
    }
}

struct LingerActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: LingerActivityAttributes.self) { context in
            LockScreenCard(context: context)
                .widgetURL(URL(string: "linger://e/\(context.attributes.code)"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    MarkTile().padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(context.attributes.title)
                            .font(serif(21))
                            .foregroundStyle(Palette.text)
                            .lineLimit(1)
                        Text(context.isStale ? context.state.closed : context.state.left)
                            .font(sans(14))
                            .foregroundStyle(Palette.muted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(spacing: 10) {
                        if let progress = context.state.progress, !context.isStale {
                            ShotsBar(progress: progress)
                        }
                        HStack {
                            Text(context.state.moments)
                            Spacer()
                            if !context.isStale { Text(context.state.reveal) }
                        }
                        .font(sans(14))
                        .foregroundStyle(Palette.muted)
                        .lineLimit(1)
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                Mark(color: Palette.text, size: 18)
            } compactTrailing: {
                if let progress = context.state.progress, !context.isStale {
                    ProgressView(value: min(max(progress, 0), 1))
                        .progressViewStyle(.circular)
                        .tint(Palette.candle)
                        .frame(width: 18, height: 18)
                } else {
                    Mark(color: Palette.candle, size: 18)
                }
            } minimal: {
                Mark(color: Palette.text, size: 18)
            }
            .widgetURL(URL(string: "linger://e/\(context.attributes.code)"))
            .keylineTint(Palette.candle)
        }
    }
}

@main
struct LingerWidgets: WidgetBundle {
    var body: some Widget {
        LingerActivityWidget()
    }
}
