# Shortcut "Send to Kindle" — Build Steps

Open **Shortcuts** app → tap **+** → tap **i** → toggle on **Share Sheet**,
accepts **URLs**.

## Actions

| # | Action | Configuration |
|---|---|---|
| 1 | **Run Scriptable** | Script: `WK2Kindle`<br>Input: `Shortcut Input` |
| 2 | **If** | Condition: `Run Scriptable` `has any value` |
| 3 | **Get Dictionary from Input** | Input: `Run Scriptable` result |
| 4 | **Get Dictionary Value** | Key: `title` |
| 5 | **Get Dictionary Value** | Key: `epubBase64` |
| 6 | **Base64 Encode** | Mode: Decode<br>Input: `epubBase64` |
| 7 | **Send Email** | To: *(your Kindle email, e.g. you@kindle.com)*<br>Subject: `convert`<br>Body: `Sent from web2kindle: {title}`<br>Attachment: Base64 Decode result<br>Filename: `article.epub` |
| 8 | **Show Notification** | Title: `Sent to Kindle`<br>Body: `{title}` |
| 9 | **Otherwise** | (from step 2 If) |
| 10 | **Show Notification** | Title: `Failed`<br>Body: `Could not process article` |

## To set up

1. Install **Scriptable** from App Store (free)
2. Create a script in Scriptable named `WK2Kindle` — paste the contents of
   `ios/wk2kindle.js`
3. Place `ios/bundle.js` at `iCloud Drive/Scriptable/web2kindle/bundle.js` —
   Scriptable reads it from its own iCloud folder
4. Build the Shortcut following the actions above
5. Set your Kindle email in the "Send Email" To: field
6. Ensure your email is configured in iOS **Mail** app
7. Verify your sending email is in Amazon's **Approved Personal Document
   Email List** at
   https://www.amazon.com/hz/mycd/myx#/home/settings/pdoc
