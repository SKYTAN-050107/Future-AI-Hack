"""Tool: Firebase Cloud Messaging push notification for low stock alerts."""

from pydantic import BaseModel
from genkit.ai import Genkit
from config.firebase_admin import get_firestore_client, get_messaging
from schemas.resources import StockAlert

class FcmInput(BaseModel):
    user_id: str
    treatment_plan: str
    current_stock: int

def register_fcm_tools(ai: Genkit):
    """Register FCM notification tools with the Genkit instance."""

    @ai.tool("send_low_stock_alert")
    async def send_low_stock_alert(input_data: FcmInput) -> dict:
        """
        Send an FCM push notification to a user's device
        when chemical stock drops below threshold (< 5 units).
        """
        msg_module = get_messaging()
        db = get_firestore_client()

        # Retrieve user's FCM token from Firestore
        user_doc = db.collection("users").document(input_data.user_id).get()
        if not user_doc.exists:
            return StockAlert(
                user_id=input_data.user_id,
                treatment_plan=input_data.treatment_plan,
                current_stock=input_data.current_stock,
                alert_sent=False,
                message="User document not found",
            ).model_dump()

        fcm_token = user_doc.to_dict().get("fcmToken")
        if not fcm_token:
            return StockAlert(
                user_id=input_data.user_id,
                treatment_plan=input_data.treatment_plan,
                current_stock=input_data.current_stock,
                alert_sent=False,
                message="No FCM token registered for user",
            ).model_dump()

        # Build and send the FCM message
        message = msg_module.Message(
            notification=msg_module.Notification(
                title="⚠️ Low Stock Alert — PadiGuard",
                body=(
                    f"Your stock of '{input_data.treatment_plan}' is critically low "
                    f"({input_data.current_stock} units remaining). "
                    f"Please restock immediately to continue treatment."
                ),
            ),
            token=fcm_token,
        )

        try:
            msg_module.send(message)
            alert_sent = True
            msg = "FCM alert sent successfully"
        except Exception as e:
            alert_sent = False
            msg = f"FCM send failed: {str(e)}"

        return StockAlert(
            user_id=input_data.user_id,
            treatment_plan=input_data.treatment_plan,
            current_stock=input_data.current_stock,
            alert_sent=alert_sent,
            message=msg,
        ).model_dump()
