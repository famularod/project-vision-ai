# Vitruvius UI Policy

This policy defines automated guardrails and the physical-device review still required for a release.

## Theme

Vitruvius currently ships one deliberate light theme. New screens must use the shared theme tokens instead of introducing isolated colors. Dark appearance is not supported until every core screen has an approved dark palette and device evidence.

## Text and controls

- Use system fonts and preserve React Native font scaling so Dynamic Type can enlarge project information.
- Core controls need meaningful accessibility labels and a usable touch target.
- Truncation may shorten secondary metadata, but it must not hide the task, project, action, or status needed to make a decision.

## Reduced motion

- Decorative animation must stop when the operating system requests reduced motion.
- Essential progress changes may update without a transition.
- Do not add an infinite loop, automatic parallax, or motion that blocks touch input.
- Automated source checks do not prove the operating-system setting is honored; physical-device review must test it.

## Asset budget

Each configured app icon, adaptive-icon foreground, splash image, and web favicon must stay at or below 1,500,000 bytes. New photo, document, and report fixtures must not be bundled into the release unless a test requires them.

## Release evidence

Automation enforces the declared theme, configured asset existence, asset budget, and this policy. Release certification still requires physical-device visual review on supported iPhone and iPad sizes, browser review, Dynamic Type, reduced motion, contrast, focus order, and touch-target checks.
