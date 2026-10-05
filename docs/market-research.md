# Posecode: market research & go-to-market

> Where Posecode spreads fastest, who pulls hardest, and which engine unlock opens
> which locked domain. Companion to [`../ROADMAP.md`](../ROADMAP.md) (engine
> capabilities) and [`../spec/llm-authoring.md`](../spec/llm-authoring.md)
> (how an LLM authors a movement).

## 1. The thesis

Posecode is **"Mermaid for human movement."** A person describes a movement in
words; an LLM writes a short `.posecode` document; the browser validates it,
constrains joint targets to configured ranges, and renders an animated 3D mannequin, producing a
**shareable URL**. The loop is:

> **ask an LLM for a movement → it renders → share the link.**

This is structurally different from video. A `.posecode` doc is **editable text**:
an LLM can generate it, a human can tweak one angle, a clinician can fork it, and
it diffs in version control. Posecode exposes the authored anatomy and constraints
for inspection instead of hiding them in a generated trajectory. Range constraints
are one correctness layer, not a certification of the complete movement. Text also
gives LLMs a structured target that can be parsed, evaluated, and revised.

### Why it can spread

- **LLM-native.** The unit of creation is a code block any chat model emits. No
  studio, no mocap, no rigging.
- **Shareable by construction.** Every movement is a URL ([`posecode-share`](../packages/posecode-share)).
  A link is the most viral object on the internet.
- **Agent-native.** The [`posecode-mcp`](../packages/posecode-mcp) server lets Claude/
  ChatGPT author, validate, and return a render link *inside the chat*: the
  movement appears where the user already is.
- **Inspectable constraints.** Configured ROM limits prevent impossible authored
  joint rotations, while contact residuals and movement checks expose failures.
  Health-adjacent uses still require qualified review.

## 2. How we scored the domains

Each domain is rated on four axes:

| Axis | Question |
| --- | --- |
| **Engine-fit today** | Does it render cleanly on the v0.1 rig (1 figure, FK, ground-locked feet/hands, no props, no reach-IK)? |
| **Customer pull** | Is there an acute, recurring need a free shareable demo satisfies? |
| **Virality** | How naturally does output get shared, embedded, or re-prompted? |
| **LLM-authorability** | Can a model reliably write correct docs with little context? |

The four domains below score highest on **engine-fit × authorability**: they
work *today*, so the catalog and the viral loop compound now rather than waiting
on the roadmap.

## 3. Target domains (ship now)

### 3a. Anatomy & movement education: *top of funnel*

- **Customer:** anatomy/kinesiology students & instructors, PT/OT/med students,
  personal-trainer certifications, biology teachers, curious people.
- **Aha use case:** "What is shoulder abduction?" → an isolated joint sweeps
  through its plane, labeled. The answer is a *moving figure*, not a static
  diagram.
- **Viral loop:** an LLM answering an anatomy question embeds a Posecode link;
  teachers paste links into slides/LMS; students re-prompt for the next joint.
- **Ships:** `shoulder-abduction-demo`, `hip-flexion-demo`, `knee-flexion-demo`,
  `spine-rotation-demo`, `elbow-flexion-pronation`.
- **Engine-fit:** ★★★★★, single-joint ROM demos are *exactly* what the rig does.

### 3b. Physiotherapy & rehab

- **Customer:** physios, chiros, athletic trainers, and their patients running
  home-exercise programs; post-op ROM protocols.
- **Aha use case:** a clinician authors or reviews a movement and hands the patient
  a link that *shows* it, with explicit joint targets and validation diagnostics.
- **Viral loop:** clinician → patient link sharing is high-frequency and trusted;
  patients forward to family; clinics build reusable libraries.
- **Ships:** `heel-raises`, `standing-hamstring-curl`, `hip-abduction`,
  `good-morning` (back-health hinge), plus existing `neck-rotation`,
  `shoulder-stretch`.
- **Engine-fit:** ★★★★☆, range constraints support review; bands/balls and
  lying poses are future (see roadmap).

### 3c. Desk & workplace wellness

- **Customer:** remote workers, HR/wellness programs, ergonomics consultants,
  "stretch break" apps.
- **Aha use case:** a recurring "do this every hour" prompt returns a fresh
  60-second posture-reset animation.
- **Viral loop:** Slack/Teams wellness bots posting a daily link; an LLM "stretch
  break" habit; embeds on internal wikis.
- **Ships:** `shoulder-rolls`, `neck-side-stretch`, `chest-opener`,
  `overhead-reach-reset`, plus existing `posture-reset`, `spinal-twist`.
- **Engine-fit:** ★★★★☆, standing variants render today; true *seated* needs a
  chair prop.

### 3d. Sports, martial arts & **dance**: *flagship*

- **Customer:** coaches, dancers/choreographers, martial-arts instructors,
  general athletes warming up.
- **Aha use case (sports/MA):** stances, strikes, and warm-up drills as
  short, snappy, shareable clips: `front-kick`, `jab-cross`, `horse-stance`,
  `bow`, `arm-circles`, `high-knee-march`.

#### Dance / choreography & movement pedagogy

Dance is where the *editable-text* and *visual-scrub* foundation provides unique utility:
a dancer or instructor can **compose or tweak movement without specialized software**,
scrub frame-by-frame through complex footwork, inspect alignment from any camera angle,
and share an interactive 3D link. Note: **LLMs are strictly optional**—the language,
deterministic parser, range-of-motion validator, and web renderer form the standalone
product foundation (see [`research/dance-audience-validation.md`](./research/dance-audience-validation.md)).

- **Customer:** dance educators teaching technique, students analyzing alignment,
  choreographers notating and archiving movement vocabulary, physical therapists.
- **Aha use case:** "scrub and orbit around a demi-plié or pirouette" →
  inspect knee tracking, heel contact, and arm lines from any 3D angle at 0.25x speed.
- **Primary value drivers:**
  - *Demonstration beyond physical limitations:* teachers with injuries or fatigue can demonstrate precise full-range movements.
  - *Complex movement breakdown:* slow scrub and 3D rotation clarify mechanics obscured in 2D video.
  - *Non-LLM authoring:* direct 3D manipulation, text editing in standard IDEs, and preset library composition.
- **Status & review:** Ballet presets (`demi-plie`, `eleve`, `releve`, `pirouette`, `chasse`)
  are validated with domain literature and kept experimental pending ongoing peer review.
- **Engine-fit:** ★★★☆☆ today (turnout, plié, elevé, relevé, pirouette, and chassé render);
  complex aerials (540, grand jeté) and partner work are future.
- **Long game:** an **open, web-native movement specification**: unlike proprietary legacy tools
  (e.g. DanceForms), Posecode documents are open text, git-diffable, and viewable in any browser.

## 4. Spread mechanics

- **MCP inside the assistant.** [`posecode-mcp`](../packages/posecode-mcp) puts authoring +
  a render link directly in Claude/ChatGPT: distribution rides on assistants we
  don't have to build an audience for.
- **Links as the unit.** [`posecode-share`](../packages/posecode-share) makes every
  movement a URL; links are forwarded, bookmarked, and embedded.
- **Gallery grouped by domain.** The playground presets carry a `domain` and the
  gallery auto-groups them (Education, Physiotherapy, Desk & posture, Martial
  arts, Warm-up, Dance, Fitness, Yoga, Mobility) so breadth is visible on the
  landing page and each domain has an obvious entry point.
- **Education as top-of-funnel.** Anatomy demos answer questions millions already
  ask LLMs daily; each answer can carry a link.
- **Workplace cadence.** "Every hour" stretch prompts create recurring,
  habit-driven link generation.
- **Embeds.** A link that renders in an iframe drops Posecode into LMSs, clinic
  portals, and blog posts.

## 5. Which engine unlock opens which domain

From [`../ROADMAP.md`](../ROADMAP.md), in rough order of leverage:

| Unlock | Domains it opens / deepens | Status |
| --- | --- | --- |
| **Hip-hinge** | Fitness (deadlift, row, good-morning), back-health physio, martial-arts bow |  shipped |
| **Reach-to-target IK** | Big share of physio (touch toes, cross-body), yoga, prop interaction |  shipped |
| **Scene props + anchors** | Sit-to-stand, box squat, wall sit, dead hang / hanging knee raise |  shipped (chair / wall / bar) |
| **Lying / seated base poses** | Floor yoga, mat Pilates, bed-based rehab (glute bridge, dead bug, cobra) |  shipped |
| **Hand / finger rig** | Grip rehab, expressive gesture, rough finger-spelling |  shipped (single-DOF) |
| **Two-person + collision** | Partner stretches, assisted rehab, contact sports |  deferred |

The strategic read: **education + physio + desk + dance** monetize the rig and
build the catalog/virality flywheel. With reach-IK, props, lying/seated poses, and
a hand rig now shipped, the roadmap's  domains (functional/elderly care, floor
yoga, loaded strength, gesture) are reachable today; the remaining frontier is
deeper props (load, bands, rings), ROM-constrained reach, and two-person work.

>  Posecode's range-of-motion values are general literature data, not medical
> advice. Consult a qualified professional for physiotherapy or exercise
> prescription.
