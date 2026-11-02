import ActivityKit
import ExpoModulesCore

// Must match targets/activity/LingerActivity.swift field for field: ActivityKit pairs the app's
// activity with the widget's view by this type's name and its encoded shape.
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

struct ActivityStateRecord: Record {
    @Field var left: String = ""
    @Field var progress: Double?
    @Field var moments: String = ""
    @Field var reveal: String = ""
    @Field var closed: String = ""
    /// Milliseconds since 1970, as JavaScript dates count.
    @Field var endsAt: Double = 0
    @Field var revealsAt: Double = 0
}

private func contentState(_ record: ActivityStateRecord) -> LingerActivityAttributes.ContentState {
    LingerActivityAttributes.ContentState(
        left: record.left,
        progress: record.progress,
        moments: record.moments,
        reveal: record.reveal,
        closed: record.closed,
        endsAt: Date(timeIntervalSince1970: record.endsAt / 1000),
        revealsAt: Date(timeIntervalSince1970: record.revealsAt / 1000)
    )
}

public class LiveActivityModule: Module {
    public func definition() -> ModuleDefinition {
        Name("LiveActivity")

        // The activity covers the shooting window, so it goes stale at the end, not the reveal.
        AsyncFunction("show") { (code: String, title: String, record: ActivityStateRecord) in
            guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
            let state = contentState(record)
            let content = ActivityContent(state: state, staleDate: state.endsAt)
            if let current = Self.activity(code) {
                await current.update(content)
                return
            }
            let attributes = LingerActivityAttributes(code: code, title: title)
            _ = try Activity.request(attributes: attributes, content: content, pushType: nil)
        }

        AsyncFunction("close") { (code: String, record: ActivityStateRecord) in
            guard let current = Self.activity(code) else { return }
            await Self.close(current, state: contentState(record))
        }

        AsyncFunction("end") { (code: String) in
            await Self.activity(code)?.end(nil, dismissalPolicy: .immediate)
        }

        // On launch: an activity whose camera closed reads the closed line until the system
        // removes it, and one whose reveal has passed goes at once.
        AsyncFunction("endPast") {
            let now = Date()
            for activity in Activity<LingerActivityAttributes>.activities {
                let state = activity.content.state
                if state.revealsAt <= now {
                    await activity.end(nil, dismissalPolicy: .immediate)
                } else if state.endsAt <= now {
                    await Self.close(activity, state: state)
                }
            }
        }
    }

    private static func close(
        _ activity: Activity<LingerActivityAttributes>,
        state: LingerActivityAttributes.ContentState
    ) async {
        let content = ActivityContent(state: state, staleDate: state.endsAt)
        // The lock screen keeps an ended activity for up to four hours; never past the reveal.
        let until = min(state.revealsAt, Date().addingTimeInterval(4 * 3600))
        await activity.end(content, dismissalPolicy: .after(until))
    }

    private static func activity(_ code: String) -> Activity<LingerActivityAttributes>? {
        Activity<LingerActivityAttributes>.activities.first { $0.attributes.code == code }
    }
}
