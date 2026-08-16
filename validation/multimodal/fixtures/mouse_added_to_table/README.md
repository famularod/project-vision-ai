# mouse_added_to_table Fixture

This directory is reserved for the physical-device validation originals for baseline failure case 001.

Required original files:

- `mouse_added_to_table_before.jpeg`
- `mouse_added_to_table_after.jpeg`

Do not add edited, compressed, cropped, or screenshot substitutes as the canonical originals.

Current status:

- Build 21 physical-device result: failed.
- True Photo Intelligence acceptance status: required.
- Exact SHA-256 hashes: calculated by regression test from original image bytes.
- Perceptual hashes: local deterministic regression can calculate image-derived hashes; production acceptance still requires the deployed vision pipeline or approved CV pipeline.
- Production completion claim: blocked until this exact pair passes through the deployed raw-pixel pipeline from a physical device.
