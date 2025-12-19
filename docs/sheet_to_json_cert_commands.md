# sheet_to_json.py commands with explicit CA bundle

- **macOS (bash/zsh):**
  - `SSL_CERT_FILE=/etc/ssl/cert.pem python scripts/sheet_to_json.py --sheet-url "<Link to google sheet>" --output <Path to where json file should be>`

- **Linux (Debian/Ubuntu example):**
  - `SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt python scripts/sheet_to_json.py --sheet-url "<Link to google sheet>"  --output <Path to where json file should be>`

- **Windows (PowerShell, using certifi from python.org):**
  - `$env:SSL_CERT_FILE = "$env:LOCALAPPDATA\Programs\Python\Python311\Lib\site-packages\certifi\cacert.pem"; python scripts/sheet_to_json.py --sheet-url "<Link to google sheet>" --output <Path to where json file should be>`


# For url links replace /edit? with /export?format=csv& so it can be parsed correctly
- **For example**
  - Url link would originally be this
    - "https://docs.google.com/spreadsheets/d/1ccD5kB8yC8xSoYsWrmfBS0HcSAmesWGOVyID1psywJg/edit?gid=0#gid=0" 
  - Edited link is
    - "https://docs.google.com/spreadsheets/d/1ccD5kB8yC8xSoYsWrmfBS0HcSAmesWGOVyID1psywJg/export?format=csv&gid=0#gid=0"