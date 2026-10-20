# Check Log on Azure: setup guide (HubSpot workflow version)

This folder is the **Assigned & Processed Check Log** rebuilt as an Azure Static Web App, the same kind of site as the Trial Tracker – Altman Pod. People sign in with their Microsoft account, and only people you invite can open it.

No HubSpot app or API key is needed. A **HubSpot workflow** sends each deal's details to the site whenever something relevant changes, and the site stores them in an Azure storage table along with your team's edits.

**What's in the folder**

| Folder / file | What it is |
|---|---|
| `src/` | The website: the check log page, the "no access" page, and `staticwebapp.config.json` (sign-in and access rules) |
| `api/` | Azure Functions: `hubspot.js` receives deals from the HubSpot workflow; `data.js` saves edits and manual rows; `lib/owners.json` lists Check Coordinator names |
| `data/existing-data.json` | Everything already saved on the claude.ai version (exported Oct 20, 2026) |
| `scripts/` | A one-time script to load that data into Azure (Step 9) |

**Before you start, check one thing in HubSpot.** The workflow's **Send a webhook** action requires **Data Hub Professional or Enterprise** (formerly Operations Hub). To confirm you have it, create a test deal-based workflow, click **+** to add an action, and look in the **Data ops** section for **Send a webhook**. If it isn't there, stop and let Claude know. There's another way to send the data (through Zapier), and the site would need a small change for it.

Allow about an hour. You'll need permission to create workflows in HubSpot, access to your Azure subscription, and a GitHub account.

---

## Step 1: Make up a webhook password

HubSpot will include a password with every update, and the site rejects updates without it.

Create a long random string of 30 or more letters and numbers, such as one from a password manager's generator. Avoid symbols. Save it for Steps 5 and 6. This guide calls it the **webhook key**.

## Step 2: Put the code on GitHub

1. Sign in to GitHub and click **New repository**. Name it `check-log`, set it to **Private**, and click **Create repository**.
2. On the new repository's page, click **uploading an existing file**.
3. Unzip `check-log-azure.zip` on your computer. Drag everything *inside* the `check-log-azure` folder (the `src`, `api`, `data` and `scripts` folders and `README.md`) into the upload box.
4. Click **Commit changes**.

Check that the repository shows `src`, `api`, `data`, and `scripts` at the top level.

## Step 3: Create a storage account

1. In the Azure portal (portal.azure.com), search for **Storage accounts** and click **Create**.
2. Choose the same subscription and resource group you used for the Altman Pod site.
3. **Storage account name:** something like `checklogdata` plus a few letters. It must be lowercase and unique.
4. **Region:** the same as your other resources. **Performance:** Standard. **Redundancy:** Locally-redundant storage (LRS).
5. Click **Review + create**, then **Create**, and wait for it to finish.
6. Open the storage account. Go to **Security + networking → Access keys**, click **Show** next to *Connection string* under key1, and copy it.

## Step 4: Create the Static Web App

1. In the Azure portal, search for **Static Web Apps** and click **Create**.
2. Fill in:
   - **Subscription / Resource group:** same as above
   - **Name:** `check-log`
   - **Plan type:** Free
   - **Source:** GitHub, then pick your organization, the `check-log` repository, and the `main` branch
3. Under **Build Details**:
   - **Build Presets:** Custom
   - **App location:** `/src`
   - **Api location:** `/api`
   - **Output location:** leave blank
4. Click **Review + create**, then **Create**.

The first deployment takes 3–5 minutes. You can watch it under the GitHub repository's **Actions** tab. When it's done, copy the site's **URL** from the Static Web App's **Overview** page, for example `https://lively-river-0abc123.5.azurestaticapps.net`.

## Step 5: Add the two secret settings

1. In the Static Web App, go to **Settings → Environment variables**.
2. Under *Production*, click **Add** for each:

   | Name | Value |
   |---|---|
   | `STORAGE_CONNECTION_STRING` | the connection string from Step 3 |
   | `WEBHOOK_SECRET` | the webhook key from Step 1 |

3. Click **Apply**, then **Confirm**.

## Step 6: Build the HubSpot workflow

1. In HubSpot, go to **Automations → Workflows**, click **Create workflow**, then **From scratch**, and choose **Deal-based**. Name it `Check Log sync`.

2. **Enrollment triggers.** Set up three triggers. Deals that meet *any* of them are enrolled.
   - **Trigger A (filter):** *Deal stage* is any of **Pending Settlement Funds (BB)**, **Pending Settlement Funds (CK)**.
   - **Trigger B (filter):** *Checks Received Date* is after **12/31/2025**, **and** *Checks Under Review* is any of **Complete**, **Manual (No SMS)**.
   - **Trigger C (event):** **Property value changed**, with *Deal stage* as the property. This lets the site see deals that leave Pending Settlement Funds, so they drop off the Assigned tab.

3. **Re-enrollment.** In the trigger settings, turn re-enrollment **on**. Choose these properties as re-enrollment triggers, so any change to them sends a fresh update:
   Deal stage, Clio Matter, Checks Received, Checks Received Date, Checks Reviewed Date, Checks Under Review, Fees by Motion, Clio Address Confirmed, Surrender Date, Plaintiff Name Short, Car Manufacturer, Check Coordinator.

4. **Action.** Click **+**, and under **Data ops** choose **Send a webhook**:
   - **Method:** POST
   - **Webhook URL:** your site's URL followed by `/api/hubspot/webhook`, for example `https://lively-river-0abc123.5.azurestaticapps.net/api/hubspot/webhook`
   - **Authentication type:** API key. **Key name:** `x-checklog-key`. **Key value:** the webhook key from Step 1. **Location:** request header
   - **Request body:** choose **Customize request body** and add the 16 properties below. In each row, type the **key** exactly as shown and pick the matching deal property as the **value**:

     | Key | Deal property |
     |---|---|
     | `hs_object_id` | Record ID |
     | `dealname` | Deal name |
     | `clio_matter` | Clio Matter |
     | `dealstage` | Deal stage |
     | `checks_received` | Checks Received |
     | `fees_by_motion` | Fees by Motion |
     | `clio_address_confirmed` | Clio Address Confirmed |
     | `surrender_date` | Surrender Date |
     | `plaintiff_name_short` | Plaintiff Name Short |
     | `car_manufacturer__cloned_` | Car Manufacturer |
     | `check_coordinator` | Check Coordinator |
     | `checks_under_review` | Checks Under Review |
     | `checks_received_date` | Checks Received Date |
     | `checks_reviewed_date` | Checks Reviewed Date |
     | `hs_v2_date_entered_1072094529` | Date entered "Pending Settlement Funds (BB)" |
     | `hs_v2_date_entered_148011373` | Date entered "Pending Settlement Funds (CK)" |

     If your HubSpot only offers **Include all properties**, use that instead; the site reads that format too.
   - **Rate limit** (if offered): 10 per second is plenty.

5. **Test it.** In the webhook action, click **Test action**, pick any deal in Pending Settlement Funds, and send. A good response looks like `{"ok":true,"saved":1,"removed":0}`. If you get **401**, the key name or value doesn't match Step 5.

6. Click **Review and publish**. When HubSpot asks whether to **enroll existing deals that meet the criteria**, choose **Yes**. This loads the roughly 3,700 deals already in the log.

7. Turn the workflow **on**. The backfill takes 10–30 minutes. After that, updates arrive within a minute or two of a change in HubSpot.

## Step 7: Invite yourself, then your team

There are two access levels:
- **`checklog-editor`** can add rows, change dropdowns and notes, and mark checks complete.
- **`checklog-viewer`** can only look; the editable columns are locked.

To invite someone:
1. In the Static Web App, go to **Settings → Role management** and click **Invite**.
2. **Authorization provider:** Microsoft Entra ID (it may show as Azure Active Directory).
3. **Invitee details:** their work email. **Domain:** filled in for you.
4. **Role:** `checklog-editor` or `checklog-viewer`. Type it exactly.
5. **Expiration:** up to 168 hours.
6. Click **Generate**, copy the **Invite link**, and send it. They open it, sign in with that Microsoft account, and accept.

Invite yourself first, as `checklog-editor`.

## Step 8: Open and check the site

Open the site's URL and sign in. Then check that:
- The Assigned Checks tab lists deals, and the top right says **Synced from HubSpot**
- The Processed Check Log shows this year's checks
- Changing a deal in HubSpot (for example its Check Coordinator) shows up on the site a minute or two later, after you click **Refresh**
- Changing a Status on the site, then clicking **Refresh**, keeps the new value

## Step 9 (optional): Bring over data from the claude.ai version

1. In the Azure portal, click the **Cloud Shell** icon (`>_`) in the top bar and choose **Bash**.
2. Click **Manage files → Upload** and upload `check-log-azure.zip`.
3. Run these commands, pasting your connection string from Step 3 between the quotes:
   ```
   unzip -o check-log-azure.zip
   cd check-log-azure/scripts
   npm install
   STORAGE_CONNECTION_STRING="paste-connection-string-here" node import-data.mjs ../data/existing-data.json
   ```
4. It should end with `Imported 153 rows into the CheckLog table.`

## Good to know

- **The site only knows what the workflow sends.** If the workflow is turned off, the site keeps showing the last data it received. If something looks out of date, check the workflow's **History** tab in HubSpot for failed webhooks.
- **New Check Coordinators** show up as `#` followed by a number. Add their ID and name to `api/src/lib/owners.json` in GitHub and commit. The ID is in the HubSpot user's URL, or Claude can look it up.
- **Making changes later:** edit files in GitHub and commit, and the site redeploys in a few minutes. Claude can make the edits for you.
- **Team size:** Free-plan invitations are fine for a small team. For a large group, move to the **Standard** plan and grant access through a Microsoft Entra group.
- **Who changed what:** each saved row records the last editor's email and time, in the `CheckLog` table (Storage account → Storage browser → Tables).
- **Retiring the claude.ai version:** once everyone is on the Azure site, stop using the claude.ai link so edits don't end up in two places.
