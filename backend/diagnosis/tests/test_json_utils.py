"""Tests for structured JSON extraction from model responses."""

from services.json_utils import extract_json_payload


class TestJsonUtils:
    def test_extract_json_from_fenced_block(self):
        raw_text = (
            "```json\n"
            '{"regions":[{"x":0.1,"y":0.2,"width":0.3,"height":0.4,"description":"Rice"}]}\n'
            "```"
        )

        payload = extract_json_payload(raw_text)

        assert payload["regions"][0]["description"] == "Rice"

    def test_extract_json_from_preamble_and_trailing_text(self):
        raw_text = (
            "Here is the result:\n"
            '{"regions":[{"x":0.1,"y":0.2,"width":0.3,"height":0.4,"description":"Tomato"}]}\n'
            "Thanks."
        )

        payload = extract_json_payload(raw_text)

        assert payload["regions"][0]["description"] == "Tomato"

    def test_extract_json_from_array(self):
        raw_text = (
            "```json\n"
            '[{"x":0.1,"y":0.2,"width":0.3,"height":0.4,"description":"Padi"}]\n'
            "```"
        )

        payload = extract_json_payload(raw_text)

        assert isinstance(payload, list)
        assert payload[0]["description"] == "Padi"