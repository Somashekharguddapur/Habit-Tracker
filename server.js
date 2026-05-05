// ============================================================
// HabitFlow OTP Backend Server
// Sends OTP via Email (Nodemailer/Gmail) & SMS (Twilio)
// ============================================================

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const nodemailer = require("nodemailer");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// Serve the HTML file
app.use(express.static(path.join(__dirname)));

// ============================================================
// In-memory OTP Store (key: email/phone, value: { otp, expiresAt })
// ============================================================
const otpStore = new Map();

// Generate a 6-digit OTP
const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

// ============================================================
// EMAIL TRANSPORTER (Gmail via Nodemailer)
// ============================================================
let emailTransporter = null;

if (process.env.EMAIL_USER && process.env.EMAIL_USER !== "your_gmail@gmail.com") {
    emailTransporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
            user: process.env.EMAIL_USER,
            pass: process.env.EMAIL_PASS,
        },
    });

    // Verify email connection on startup
    emailTransporter.verify((err, success) => {
        if (err) {
            console.error("❌ Email setup failed:", err.message);
            console.log("   → Check your EMAIL_USER and EMAIL_PASS in .env");
            emailTransporter = null;
        } else {
            console.log("✅ Email transporter ready (Gmail)");
        }
    });
} else {
    console.log("⚠️  Email not configured. Set EMAIL_USER & EMAIL_PASS in .env");
}

// ============================================================
// TWILIO SMS CLIENT
// ============================================================
let twilioClient = null;
let twilioPhoneNumber = null;

if (
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_ACCOUNT_SID !== "your_twilio_account_sid"
) {
    try {
        const twilio = require("twilio");
        twilioClient = twilio(
            process.env.TWILIO_ACCOUNT_SID,
            process.env.TWILIO_AUTH_TOKEN
        );
        twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
        console.log("✅ Twilio SMS client ready");
    } catch (err) {
        console.error("❌ Twilio setup failed:", err.message);
    }
} else {
    console.log("⚠️  Twilio not configured. Set TWILIO_* values in .env");
}

// ============================================================
// API: Send OTP
// POST /api/send-otp
// Body: { "to": "email@example.com" } or { "to": "+1234567890" }
// ============================================================
app.post("/api/send-otp", async (req, res) => {
    const { to, name } = req.body;

    if (!to) {
        return res.status(400).json({ success: false, message: "Recipient (to) is required." });
    }

    const otp = generateOtp();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes

    // Store OTP
    otpStore.set(to, { otp, expiresAt });

    // Auto-cleanup after 5 minutes
    setTimeout(() => otpStore.delete(to), 5 * 60 * 1000);

    const isEmail = to.includes("@");

    if (isEmail) {
        // ---- SEND VIA EMAIL ----
        if (!emailTransporter) {
            // Fallback: return OTP in response (demo mode)
            return res.json({
                success: true,
                method: "email_fallback",
                message: "Email not configured. OTP shown as fallback.",
                otp: otp, // Only in demo mode
            });
        }

        try {
            await emailTransporter.sendMail({
                from: `"HabitFlow Tracker" <${process.env.EMAIL_USER}>`,
                to: to,
                subject: "🔐 Your HabitFlow Verification Code",
                html: `
                    <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 30px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 16px;">
                        <div style="background: white; border-radius: 12px; padding: 40px; text-align: center;">
                            <div style="width: 60px; height: 60px; background: linear-gradient(135deg, #6366f1, #8b5cf6); border-radius: 16px; margin: 0 auto 20px; display: flex; align-items: center; justify-content: center;">
                                <span style="font-size: 28px; color: white;">🔒</span>
                            </div>
                            <h1 style="color: #1e293b; font-size: 24px; margin-bottom: 8px;">Verification Code</h1>
                            <p style="color: #64748b; font-size: 14px; margin-bottom: 30px;">
                                Hi ${name || to.split("@")[0]}, use the code below to verify your HabitFlow account.
                            </p>
                            <div style="background: #f1f5f9; border-radius: 12px; padding: 20px; margin: 20px 0;">
                                <span style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #4f46e5;">${otp}</span>
                            </div>
                            <p style="color: #94a3b8; font-size: 12px; margin-top: 20px;">
                                This code expires in <strong>5 minutes</strong>. Don't share it with anyone.
                            </p>
                            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;">
                            <p style="color: #cbd5e1; font-size: 11px;">
                                If you didn't request this code, you can safely ignore this email.
                            </p>
                        </div>
                    </div>
                `,
            });

            console.log(`📧 OTP sent to email: ${to}`);
            return res.json({
                success: true,
                method: "email",
                message: `OTP sent to ${to}`,
            });
        } catch (err) {
            console.error("Email send error:", err.message);
            return res.json({
                success: true,
                method: "email_fallback",
                message: "Email failed. OTP shown as fallback.",
                otp: otp,
            });
        }
    } else {
        // ---- SEND VIA SMS ----
        if (!twilioClient) {
            // Fallback: return OTP in response (demo mode)
            return res.json({
                success: true,
                method: "sms_fallback",
                message: "Twilio not configured. OTP shown as fallback.",
                otp: otp, // Only in demo mode
            });
        }

        try {
            await twilioClient.messages.create({
                body: `🔐 HabitFlow Verification Code: ${otp}\n\nThis code expires in 5 minutes. Don't share it with anyone.`,
                from: twilioPhoneNumber,
                to: to,
            });

            console.log(`📱 OTP sent via SMS to: ${to}`);
            return res.json({
                success: true,
                method: "sms",
                message: `OTP sent to ${to}`,
            });
        } catch (err) {
            console.error("SMS send error:", err.message);
            return res.json({
                success: true,
                method: "sms_fallback",
                message: "SMS failed. OTP shown as fallback.",
                otp: otp,
            });
        }
    }
});

// ============================================================
// API: Verify OTP
// POST /api/verify-otp
// Body: { "to": "email@example.com", "otp": "123456" }
// ============================================================
app.post("/api/verify-otp", (req, res) => {
    const { to, otp } = req.body;

    if (!to || !otp) {
        return res.status(400).json({ success: false, message: "Recipient and OTP are required." });
    }

    const stored = otpStore.get(to);

    if (!stored) {
        return res.json({ success: false, message: "OTP expired or not found. Please request a new one." });
    }

    if (Date.now() > stored.expiresAt) {
        otpStore.delete(to);
        return res.json({ success: false, message: "OTP has expired. Please request a new one." });
    }

    if (stored.otp !== otp) {
        return res.json({ success: false, message: "Invalid OTP. Please try again." });
    }

    // OTP verified, remove it
    otpStore.delete(to);
    return res.json({ success: true, message: "OTP verified successfully!" });
});

// ============================================================
// API: Health check
// ============================================================
app.get("/api/status", (req, res) => {
    res.json({
        server: "running",
        email: emailTransporter ? "configured" : "not configured",
        sms: twilioClient ? "configured" : "not configured",
    });
});

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`\n🚀 HabitFlow Backend running at http://localhost:${PORT}`);
    console.log(`📄 Open http://localhost:${PORT}/habit_tracker.html in your browser\n`);
    console.log("─────────────────────────────────────");
    console.log("  Service Status:");
    console.log(`  📧 Email: ${emailTransporter ? "✅ Ready" : "⚠️  Not configured"}`);
    console.log(`  📱 SMS:   ${twilioClient ? "✅ Ready" : "⚠️  Not configured"}`);
    console.log("─────────────────────────────────────\n");
});
