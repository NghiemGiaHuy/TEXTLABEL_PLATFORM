"""
app/utils/email.py
Email utility for sending transactional emails (password reset).
In development mode, logs email to console instead of sending.
"""

import logging
from app.core.config import settings

logger = logging.getLogger(__name__)


async def send_password_reset_email(to_email: str, reset_token: str) -> None:
    """
    Send password reset email.
    In development: logs the reset link to console.
    In production: sends via SMTP.
    """
    reset_link = f"http://localhost:5173/reset-password?token={reset_token}"

    if settings.APP_ENV == "development" or not settings.SMTP_USER:
        # Development mode: log to console
        logger.info(
            f"\n{'='*60}\n"
            f"📧 PASSWORD RESET EMAIL\n"
            f"To: {to_email}\n"
            f"Reset Link: {reset_link}\n"
            f"Token: {reset_token}\n"
            f"Expires in: {settings.PASSWORD_RESET_EXPIRE_MINUTES} minutes\n"
            f"{'='*60}\n"
        )
        return

    # Production mode: send via SMTP
    try:
        import aiosmtplib
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart

        message = MIMEMultipart("alternative")
        message["From"] = settings.MAIL_FROM
        message["To"] = to_email
        message["Subject"] = f"{settings.APP_NAME} - Password Reset"

        html_body = f"""
        <html>
        <body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2 style="color: #1a1a2e;">Password Reset Request</h2>
            <p>You requested a password reset for your {settings.APP_NAME} account.</p>
            <p>Click the button below to reset your password:</p>
            <a href="{reset_link}"
               style="display: inline-block; background: #4f46e5; color: white;
                      padding: 12px 24px; border-radius: 6px; text-decoration: none;
                      margin: 16px 0;">
                Reset Password
            </a>
            <p style="color: #666; font-size: 14px;">
                This link expires in {settings.PASSWORD_RESET_EXPIRE_MINUTES} minutes.
                If you didn't request this, you can safely ignore this email.
            </p>
        </body>
        </html>
        """

        message.attach(MIMEText(html_body, "html"))

        await aiosmtplib.send(
            message,
            hostname=settings.SMTP_HOST,
            port=settings.SMTP_PORT,
            username=settings.SMTP_USER,
            password=settings.SMTP_PASSWORD,
            start_tls=True,
        )
        logger.info(f"Password reset email sent to {to_email}")

    except Exception as e:
        logger.error(f"Failed to send reset email to {to_email}: {e}")
        # Don't raise — still return 200 to client