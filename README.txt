MIHRAB – server version
1. Install Node.js (LTS) from https://nodejs.org on the PC that will host the system.
2. Double-click start.bat. A window shows the addresses. Keep it open.
3. Open http://localhost:3000 on this PC. Other PCs on the same Wi-Fi/network open http://<this PC's address>:3000 (shown in the window).
   If Windows asks about the firewall, choose Allow (private networks).
4. First login: admin / admin123 and hr / hr123. Click "Change password" immediately.
5. Admin > Teachers > Add teacher creates each teacher's login.
Data is stored in data.json. A copy is saved to the backups folder every 6 hours. To reset, stop the server and delete data.json.

AUTOMATIC WHATSAPP REMINDERS (30 minutes before each lesson, English)
Without setup, reminders appear in Messages > Reminders and you send each with one click.
To make them fully automatic you need the WhatsApp Business Platform (Cloud API) from Meta:
1. Create a Meta Business account and a WhatsApp Business app at developers.facebook.com, and add the Mihrab number.
2. Create a message template named  class_reminder  (category: Utility, language: English) with this body:
   Assalamu alaikum! A friendly reminder from MIHRAB Educational Institute: {{1}}'s {{2}} lesson with {{3}} starts today at {{4}} (in about 30 minutes). Jazakum Allahu khairan.
   Wait until Meta approves it.
3. Copy whatsapp.json.example to whatsapp.json (same folder as server.js) and fill in your permanent access token and phone number ID.
4. Keep the server running. No restart is needed after editing whatsapp.json.
Reminders are skipped for cancelled lessons and students without a number. Each lesson is reminded once.
