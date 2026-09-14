# Build 192 embedded-framework signing correction

The initial Build 192 artifact passed the outer `codesign --verify --deep
--strict` check but both physical devices rejected installation with
`0xe800801c`, naming unsigned `hermesvm.framework`. Direct inspection confirmed
that framework had no signature. The prior artifact is retained unchanged as
failure evidence; it is not a successfully installed release.

The release gate now independently inspects and verifies the main executable and
every enumerated embedded framework executable. It requires an Apple signing
authority and the same team for all, rejecting unsigned, ad-hoc, wrong-team,
invalid and empty signature inventories. Unit negatives pass; importantly, the
actual failed artifact now fails the revised check.

Created a separate copy of the dd11411 application payload, signed all four
embedded frameworks with the existing Apple Development identity, then signed
the outer application using its existing entitlements and provisioning profile.
No JavaScript, project data, account, provisioning entitlement or SDK changed.

Corrected artifact: `../research/build192-nested-signed/Vitruvius.app`.
Inventory: 49 files, SHA-256
`a3cafc932f9d91d24506d775904498e450e01e8a05fb6291b312792d5cc7b9b1`.
This supersedes the original 45-file artifact identity, not its retained record.

Both physical devices accepted installation, with independent app inventory
readback showing version 1.0.192, build 192. iPhone visibly launched retaining the
signed-in owner account. This proves installation and one startup, not complete
beta acceptance. Device install receipts are outside source control in
`research/build192-iphone-nested-install.json` and
`research/build192-ipad-nested-install.json`.

Follow-up: the gate enumerates the current app's four top-level frameworks. Any
new extension, nested framework or loose dynamic library must be explicitly
included before a release; whole-bundle signature verification alone is not
device installation evidence.
