from flask import Flask, request, jsonify
from lti import ToolConsumer
import requests

app = Flask(__name__)

@app.route("/validate", methods=["POST"])
def validate():
    data = request.get_json()
    try:
        params = {
            "user_id": "test_user",
            "resource_link_id": "test_resource",
            "lti_version": "LTI-1p0",
            "lti_message_type": "basic-lti-launch-request"
        }
        params.update(data.get("params", {}))

        consumer = ToolConsumer(
            consumer_key=data["key"],
            consumer_secret=data["secret"],
            launch_url=data["launch_url"],
            params=params
        )
        launch_data = consumer.generate_launch_data()
        headers = {'Content-Type': 'application/x-www-form-urlencoded'}

        response = requests.post(data["launch_url"], data=launch_data, headers=headers, timeout=10)

        return jsonify({
            "launchable": response.status_code == 200 and response.ok,
            "status_code": response.status_code,
            "launch_url": data["launch_url"]
        })

    except Exception as e:
        return jsonify({
            "launchable": False,
            "status_code": None,
            "launch_url": data.get("launch_url"),
            "error": str(e)
        }), 500

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=4000)

