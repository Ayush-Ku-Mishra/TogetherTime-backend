import sgMail from '@sendgrid/mail';

export const sendGridEmail = async ({ email, subject, message }) => {
  try {
    // Initialize SendGrid with API key
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    
    console.log(`Attempting to send email to: ${email} via SendGrid`);
    
    // Create message object
    const msg = {
      to: email,
      from: process.env.SENDGRID_FROM_EMAIL, // Your verified sender
      subject: subject,
      html: message,
    };
    
    // Send email
    const response = await sgMail.send(msg);
    console.log('Email sent successfully via SendGrid');
    return response;
  } catch (error) {
    console.error('SendGrid email error:', error);
    
    // Enhanced error logging
    if (error.response) {
      console.error('SendGrid API error details:', {
        body: error.response.body,
        statusCode: error.code
      });
    }
    
    throw error;
  }
};