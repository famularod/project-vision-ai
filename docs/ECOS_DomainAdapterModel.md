# ECOS Domain Adapter Model

## Purpose

The ECOS Domain Adapter keeps ECOS Core reasoning separate from project-specific interpretation.

ECOS Cognitive Framework defines how thinking works.

Domain adapters translate project evidence into ECOS Core input and translate
ECOS Core output back into project-specific proposals. ECOS Assurance validates
the result independently before any material change can be final.

## Adapter Flow

```text
Domain Evidence
  -> Domain Adapter
  -> ECOS Cognitive Framework
  -> Domain Adapter
  -> Domain Intelligence Output
```

For the current product:

```text
PIE data
  -> PIEDomainAdapter
  -> ECOSCognitiveFramework
  -> PIEDomainAdapter
  -> PIECoreIntelligence output
```

## Responsibility Split

ECOS owns domain-neutral thinking:

- observation
- evidence review
- interpretation
- memory recall
- pattern recognition
- hypothesis formation
- self-challenge
- belief formation
- deliberation
- prediction
- decision scoring
- recommendation
- explanation
- reflection
- learning
- uncertainty reduction

Domain adapters own translation:

- domain evidence to generic evidence
- domain goals to generic goals
- domain constraints to generic constraints
- domain risks to generic risks
- domain decisions to generic decisions
- ECOS recommendations back to domain recommendations
- ECOS uncertainty back to domain uncertainty
- ECOS explanations back to domain report or decision insight

Domain engines own domain-specific reasoning and output.

Apps own capture, interaction, approval, and display.

## Current Compatibility Adapter

`PIEDomainAdapter` is the legacy internal identifier for the current Vitruvius
project adapter. It remains temporarily to avoid risky module and contract
renames; it does not identify a separate user-facing system.

PIE-specific inputs may include:

- projects
- project areas
- schedule items
- photos
- GPS/location context
- notes
- reports
- issues
- safety observations
- inspections
- decisions
- contractors
- evidence fusion
- knowledge graph
- runtime state

PIE-specific outputs include:

- project beliefs
- project risks
- project decisions
- project recommendations
- project uncertainty
- project next best actions
- report insights

## Rule

If a capability is domain-independent reasoning, it belongs to ECOS Core.

If a capability translates between a domain and ECOS, it belongs to a Domain Adapter.

If a capability verifies a proposal or durable result, it belongs to ECOS Assurance.
