# Photo Intelligence Data Flow

Photo intelligence is optional analysis of user-selected field evidence. The
mobile app first copies and verifies owned local files, then uploads private
evidence objects under the authenticated project scope. The mobile client does
not send a user-supplied provider endpoint or provider credential.

The authenticated `pie-photo-vision` edge function creates short-lived signed
URLs for the exact authorized evidence IDs and submits only the selected current
photo or current/prior pair to the configured vision provider. Requests include
the project name, selected area, field notes, evidence IDs, content hashes, and
the prompt/policy versions needed to interpret the result. The OpenAI Responses
request sets `store: false` explicitly.

Provider output is untrusted until it passes the shared strict schema,
normalization, visual-authority, and project/evidence ownership checks. A visual
result may support an observation; it cannot by itself approve work, change a
schedule, close a blocker, or prove compliance. Raw evidence, normalized output,
and analysis records remain subject to the app's disclosed project retention and
deletion policy. Production release requires a deployed-edge verification that
the reviewed source and provider-retention setting match the live function.
