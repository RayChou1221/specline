---
name: frontend-design
description: >-
  Designs and refines visible web interfaces with theme-rooted visual direction,
  real content, responsive and accessible states, and capability-aware verification.
  Use when creating or visually redesigning pages, components, layouts, styles,
  visual hierarchy, motion, or other user-visible UI states.
license: Apache-2.0; complete terms in LICENSE
---

# Frontend Design

Treat visible UI as a specific design problem, not a styling exercise. Create a coherent point of view rooted in the subject while preserving explicit requirements and the product's established language.

## Apply the right authority and mode

Resolve design choices in this order:

1. explicit Spec requirements;
2. the project's existing design system and brand rules;
3. the change-local `design.md` UI Design Brief;
4. this general frontend design discipline;
5. Agent discretion.

Classify the work before designing:

- **Greenfield/Redesign:** a new visual language is allowed when it follows the subject, audience, and page job. Define it deliberately; do not default to novelty for its own sake.
- **Existing Product/Incremental Feature:** preserve existing tokens, components, typography, colors, spacing, interaction patterns, and vocabulary. Do not introduce a new font, global palette, or isolated visual style unless a higher-priority source explicitly authorizes it.

If the task changes no visible UI, skip this design workflow. Do not invent a design brief for logic-only work.

## Ground the direction in the subject

Name the concrete subject, audience, and single page job before making visual choices. Use the subject's own materials, artifacts, instruments, language, data, and workflows as design sources. Build with credible real content from that world; placeholders conceal whether the information structure works.

For a page, treat the hero as its thesis. Lead with the most characteristic, useful expression of the subject: a clear proposition, image, interaction, live example, or meaningful datum. A conventional marketing hero is appropriate only when it truthfully serves the page job.

Structure is information. Headings, groups, dividers, labels, numbering, and hierarchy must encode real relationships. Use sequence markers only for actual sequences; use comparison layouts only for genuine comparisons.

Spend boldness once. Choose at most one primary **Signature Element**—the memorable visual or interaction idea that embodies the theme. Keep the supporting system disciplined. A second bold motif requires replacing, not stacking onto, the first.

## Plan

Before Build, write a compact design plan:

- **Color:** 4–6 named colors with semantic roles and values when known; inherit project tokens in Existing Product mode.
- **Typography:** display, body, label, and data roles as applicable, including existing font constraints.
- **Layout:** one concept plus a short prose or ASCII wireframe showing real information and the hero thesis when applicable.
- **Signature:** one justified element, or `none` when restraint better serves the subject.

Also note the applicable user-visible states and the responsive/accessibility constraints. Keep the plan short enough to guide implementation rather than becoming a parallel specification.

## Anti-template Check

Review the plan before writing UI code. Ask whether each choice follows this subject or could be pasted unchanged into an unrelated product. Remove ornamental structure and generic copy that do not carry meaning.

Explicitly test for context-free defaults such as:

- warm cream, high-contrast serif, and terracotta used without a subject or brand reason;
- near-black surfaces with acid-green or vermilion accents used as automatic “tech” styling;
- broadsheet/newspaper layouts with hairline rules, dense columns, and zero-radius geometry used without an editorial information model.

These are not prohibited styles. Keep them when a higher-priority Spec, existing brand, design system, or well-grounded UI Brief clearly calls for them. The failure is unexamined reuse, not the style itself. State what was revised and why before Build.

## Build

Implement the approved plan faithfully and reuse the established design system first. Match technical complexity to the visual direction: expressive work needs complete execution; minimal work needs exact spacing, typography, hierarchy, and states.

Write from the user's side of the screen:

- name concepts people recognize and control, not internal architecture;
- prefer specific, active labels such as “Save changes” over “Submit”;
- keep action names consistent from control through confirmation;
- use plain language and credible content rather than promotional filler;
- make empty states direct the next action and errors explain what happened and how to recover.

Implement every applicable state: loading, empty, error, success, and disabled. Do not add states mechanically when the interaction cannot enter them; record their non-applicability instead.

Build responsive behavior from narrow to wide or verify each breakpoint deliberately. Preserve readable order, target size, contrast, semantic structure, keyboard operation, visible focus, and accessible names. Respect `prefers-reduced-motion`; motion must have a purpose, trigger, and reduced or static fallback. Never make motion the only carrier of meaning.

## Verify

Inventory the capabilities actually available for this task before claiming verification. Run all applicable checks that are both in scope and supported:

- static lint, type, test, and build checks;
- responsive viewport inspection;
- browser interaction and screenshot review;
- keyboard navigation and visible focus;
- loading, empty, error, success, and disabled states;
- reduced-motion behavior and applicable accessibility checks.

When browser or screenshot capability is available and the task scope permits it, use it. Report evidence only for checks performed. Use these statuses consistently:

- `verified`: the applicable check ran and passed, with evidence;
- `failed`: an executed check failed—including any static lint, test, or build failure;
- `not_verified`: an applicable visible-UI check could not run because the required capability is explicitly unavailable; include the reason;
- `not_applicable`: the check does not apply to this task.

Never convert a failed static check into `not_verified`, and never describe an unperformed visual inspection as passed.

## Refine

Critique the built result against the Spec, existing product constraints, UI Brief, and plan. Remove decoration that competes with the signature or page job. Fix weak hierarchy, generic or inconsistent copy, broken state transitions, overflow, cramped mobile layouts, keyboard traps, invisible focus, excessive motion, and inaccessible contrast or semantics. Re-run affected checks after refinement and report the final evidence honestly.
