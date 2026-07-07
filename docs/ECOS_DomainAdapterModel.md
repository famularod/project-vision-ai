# ECOS Domain Adapter Model

## Purpose

The ECOS Domain Adapter keeps reusable cognition separate from domain-specific intelligence.

ECOS Cognitive Framework defines how thinking works.

Domain adapters translate domain evidence into ECOS generic cognitive input and translate ECOS cognitive output back into domain-specific intelligence.

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

## Current Adapter

PIE is the first domain adapter.

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

## Future Adapters

Future domain engines should use the same adapter pattern:

- MIE: Manufacturing Intelligence Engine
- Maintenance Intelligence Engine
- SIE: Safety Intelligence Engine
- CIE: Compliance Intelligence Engine
- FIE: Facilities Intelligence Engine
- Logistics Intelligence Engine

## Rule

If a capability is domain-independent, it belongs to ECOS Cognitive Framework.

If a capability translates between a domain and ECOS, it belongs to a Domain Adapter.

If a capability is domain-specific reasoning or output, it belongs to the Domain Intelligence Engine.
