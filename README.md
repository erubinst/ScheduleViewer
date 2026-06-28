# ScheduleViewer
Schedule view for AICaring Project

## Testing On A Phone

To open the app on a phone while developing:

1. Connect your computer and phone to the same Wi-Fi network.
2. Start the frontend from `schedule-viewer` with `npm start`.
3. Start the backend from `schedule-viewer/backend` if the app needs live API data.
4. Find your computer's local IP address, such as `192.168.1.72`.
5. On your phone, open `http://<your-ip>:3000` in the browser.

The frontend is configured to listen on all network interfaces, so the same dev server can be reached from the phone over your LAN. If the backend is running locally too, make sure it is also reachable from the phone through the same network.
