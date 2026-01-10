import nodemailer from 'nodemailer';
import { sendGridEmail } from './sendGridEmail.js';


// Determine which email service to use
const useProduction = process.env.NODE_ENV === 'production';

export const sendEmail = async (options) => {
  try {
    console.log(`Sending email to ${options.email} using ${useProduction ? 'SendGrid' : 'SMTP'}`);
    
    if (useProduction) {
      // Use SendGrid in production
      return await sendGridEmail(options);
    } else {
      // Use SMTP in development
      const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: process.env.SMTP_PORT,
        service: process.env.SMTP_SERVICE,
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
      
      console.log('Email sent successfully via SMTP');
      return mailResponse;
    }
  } catch (error) {
    console.error('Email send error:', error);
    throw error;
  }
};