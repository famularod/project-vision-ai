# Vitruvius and ECOS Naming and Architecture

Status: approved canonical product standard

## Canonical identity

**Vitruvius Project Intelligence, powered by ECOS.**

| Layer | Canonical name | Responsibility |
|---|---|---|
| Application | Vitruvius | The product people open and use |
| Customer-facing product name | Vitruvius Project Intelligence | The complete product description |
| Intelligence platform | ECOS | Evidence, reasoning, validation, and learning |
| Reasoning component | ECOS Core | Interprets evidence and prepares proposed conclusions, risks, updates, and actions |
| Independent validation component | ECOS Assurance | Verifies evidence, confidence, identity, authority, rules, approvals, synchronization, and release quality |

Vitruvius is the product. ECOS is the intelligence system. ECOS Core reasons.
ECOS Assurance verifies.

## Non-negotiable responsibility boundary

ECOS Core must not approve its own work. Core output remains a proposal until
the applicable ECOS Assurance checks and required human approval are complete.

ECOS Core may interpret voice and keyboard instructions, analyze project
evidence, identify risks and inconsistencies, propose task changes, recommend
actions, and generate draft conclusions.

ECOS Assurance independently verifies:

- evidence support and confidence levels;
- project and record identity;
- permissions and authority;
- business-rule compliance;
- human-approval requirements;
- synchronization and save confirmation; and
- test and release requirements.

The interface presents the unified ECOS identity without portraying it as a
person or character. Preferred language describes analysis, evidence,
confidence, review, recommendations, and verification.

## Compatibility migration

The former product and component labels are retired from interface copy and
current product documentation. Existing implementation identifiers may remain
temporarily where renaming would create technical risk. This includes module
names, storage keys, database objects, migrations, API contracts, validation
assets, and compatibility commands.

Migration order:

1. Keep Vitruvius and ECOS as the only current product names.
2. Update visible interface language and current product documentation.
3. Add canonical command aliases while retaining safe compatibility paths.
4. Rename internal modules only during controlled refactoring.
5. Do not rename database or backend contracts solely for branding.
6. Preserve independent ECOS Assurance gates throughout the transition.

## Example decision flow

For an instruction to set the Ramp task to 50 percent while keeping it Waiting
for approval, ECOS Core prepares the proposed field changes. ECOS Assurance
independently checks the requested Waiting status, preserves unmentioned fields,
confirms project and task identity, keeps the change proposed until confirmation,
and verifies the final save and synchronization.

The interface says: **ECOS prepared the following changes for review.**
