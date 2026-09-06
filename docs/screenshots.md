# Release screenshots

Status: global, nested Fleet workers, timeline and mobile screenshots captured
with Playwright against the real plugin in BB; RPC responses use synthetic data.
The images were visually reviewed. No private screenshots selected for publication.
Use the real plugin UI with clearly labeled synthetic fixture data. A fixture
must not claim to be a physical-device or live inference verification.

| Asset | Required content | Status |
| --- | --- | --- |
| Hero/global | Two active sample executions, attention, recent | global.png |
| Focus | One running sample execution with model/tool state | Pending |
| Multi-agent | Concurrent workers with truthful lifecycle fields | Pending |
| Fleet | Linked workers and friendly sample server names | global.png |
| Timeline | Start, model, tool and public update | timeline.png |
| Mobile | Android-width global dashboard and nested workers | mobile-360.png / mobile-412.png |

Use `example-project`, `example-thread-id`, `/home/user/project`, safe model
names and synthetic public updates. Review the whole image for conversations,
account details, endpoint URLs, personal paths and errors. Capture at readable
resolution with consistent theme and crops. Do not use generated artwork to
represent the product UI. An animation is optional after still images pass review.

Physical Android checklist: global Needs Attention, Active Work, nested Fleet
workers, Recent, Timeline, scoped board; no horizontal overflow. Record device,
viewport, BB version and result. An emulated viewport cannot satisfy this check.

Emulated Chromium results: document/viewport widths 1440/1440, 412/412, 360/360;
plugin scroll width matches its width at each viewport. Reduced-motion preference
was enabled. No page errors in the successful capture run. Physical Android is unverified.
