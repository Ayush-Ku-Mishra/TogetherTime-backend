import nodemailer from "nodemailer";

export const sendEmail = async (options) => {
  try {
    console.log(`📧 Sending email to ${options.email} using SMTP`);

    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT),
      secure: process.env.SMTP_PORT == 465, // true for 465, false for 587
      auth: {
        user: process.env.SMTP_MAIL,
        pass: process.env.SMTP_PASSWORD,
      },
    });

    const mailResponse = await transporter.sendMail({
      from: process.env.SMTP_MAIL,
      to: options.email,
      subject: options.subject,
      html: options.message,
    });

    console.log("✅ Email sent successfully via SMTP");
    return mailResponse;
  } catch (error) {
    console.error("❌ Email send error:", error);
    throw error;
  }
};
