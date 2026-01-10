import jwt from "jsonwebtoken";

export const sendToken = (user, statusCode, message, res) => {
  try {
    // Generate token based on whether user is Mongoose document or plain object
    let token;
    if (typeof user.generateToken === "function") {
      // User is a Mongoose document
      token = user.generateToken();
    } else {
      // User is a plain object from direct MongoDB access
      const id = typeof user._id === "object" ? user._id.toString() : user._id;
      token = jwt.sign({ id }, process.env.JWT_SECRET_KEY, {
        expiresIn: process.env.JWT_EXPIRE || "7d",
      });
    }

    console.log("Token generated successfully");

    // Cookie settings
    const cookieOptions = {
      expires: new Date(
        Date.now() +
          (parseInt(process.env.COOKIE_EXPIRE) || 7) * 24 * 60 * 60 * 1000
      ),
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: process.env.NODE_ENV === "production" ? "None" : "Lax",
    };

    res.status(statusCode).cookie("token", token, cookieOptions).json({
      success: true,
      message,
      user,
      token,
    });

    console.log("Response sent successfully");
  } catch (error) {
    console.error("sendToken error:", error);
    res.status(500).json({
      success: false,
      message: "Error generating authentication token",
    });
  }
};
