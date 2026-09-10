ALTER TABLE visitor_schemes
    ADD COLUMN IF NOT EXISTS widget_settings JSONB NOT NULL DEFAULT '{
      "greetingMessage": "Hi, message us with any questions. We''re happy to help!",
      "chatBackgroundColor": "#FFFFFF",
      "chatFontColor": "#000000",
      "launcherBackgroundColor": "#000000",
      "launcherTextColor": "#FFFFFF",
      "launcherIcon": "chat_bubble",
      "launcherLabel": "chat",
      "horizontalPosition": "right",
      "verticalPosition": "lowest",
      "inheritFont": true,
      "borderRadius": 16
    }'::jsonb;
