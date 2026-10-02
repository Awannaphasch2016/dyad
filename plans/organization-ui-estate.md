# Organization name, color, and the Admin tab

> Written 2026-09-27 from the iPad notes. Every signed-in person can still create an organization, and the creator is its admin.

## Summary

The active organization is chosen from the title bar, before the app tabs. Clicking its name opens a list. Each organization has one stable color logo. **Create organization** leaves the title bar and lives in the Admin tab. The Admin tab's sidebar and main page both follow the organization that is selected.

## Title bar

Order, from the left:

1. wewebplus mark
2. The active organization's color logo and name
3. App tabs, starting with the selected app or "No app selected"

The name is a button. Clicking it opens a list. Each row is that account's color logo and name: Private, then each organization the person belongs to. The current row is marked. Choosing a row switches the account, remembers it, and refreshes apps and Admin. The list does not contain Create organization.

Signed out, this control is absent and the title bar shows Sign in.

## One color per organization

Each organization gets one color, chosen from a fixed palette by its id, so the same organization keeps the same color on iPad and Electron. Private has its own fixed color. The color is a disc with the organization's initial. It appears in the title bar, in each row of the picker list, and at the top of the Admin tab. People do not upload a logo in this change.

## Admin tab estate

The Admin shield in the sidebar rail stays. Opening it shows two areas: the sidebar panel, and the main page.

### Sidebar panel

- Heading: Admin
- A line under the heading: the active color logo and organization name. This line is not a second picker.
- Two sections:
  1. **Members & permissions**
  2. **Create organization**

Create organization is available to every signed-in person, on Private and inside an organization they were invited to.

### Main page: Members & permissions

Follows the active account.

- **Private.** The page says this account has no members. There is no invite form and no role editor.
- **Organization, you are admin.** Color logo and name, then the member table, the email invite with a role, and the roles table. The creator of this organization sees this page.
- **Organization, you are reviewer or dev.** The same member table, read only, with the line that only admins can invite or change roles.

### Main page: Create organization

A name field and Create. Success switches the active account to the new organization, assigns its color, adds it to the picker list, and opens Members & permissions for it. The creator is its admin, so the invite form is on that page. A Clerk error stays on the form. The previous account stays selected.

Switching organization from the title-bar list while Admin is open updates the sidebar line, the members page, and the app list. A half-typed create name stays until Create succeeds.

## What else the organization changes

- The Apps tab lists only that organization's apps.
- An app tab that belongs to the previous organization closes when you switch, so the title bar does not keep another organization's app.
- Chat, files, and Admin members all follow the same selected organization.
- Private and an organization still do not share apps.

## Out of scope

- Uploaded logos, nested organizations, and moving apps between accounts.
- Putting Create organization back in the title bar or inside the picker list.

## Work

- [ ] Replace the title-bar account select with a color logo and a menu placed before the app tabs. Remove Create organization from the title bar.
- [ ] Assign one palette color per organization id, and one fixed color for Private.
- [ ] Add Create organization as the second Admin sidebar section, and show its form on the main page.
- [ ] Keep Members & permissions as the first section, with the Private, admin, and reviewer states above.
- [ ] On iPad: open the list and switch organization, confirm the color and the app list change, then create an organization from the Admin tab and land as its admin.
