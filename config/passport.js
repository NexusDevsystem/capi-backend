import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import prisma from '../prisma/client.js';

// Configure Google OAuth Strategy
passport.use(
    new GoogleStrategy(
        {
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3001/auth/google/callback',
            scope: ['profile', 'email']
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                console.log('[Google OAuth] Profile received:', {
                    id: profile.id,
                    email: profile.emails?.[0]?.value,
                    name: profile.displayName
                });

                // Extract user data from Google profile
                const googleData = {
                    googleId: profile.id,
                    email: profile.emails?.[0]?.value,
                    name: profile.displayName,
                    photoUrl: profile.photos?.[0]?.value
                };

                if (!googleData.email) {
                    return done(new Error('No email provided by Google'), null);
                }

                // Check if user exists
                let user = await prisma.user.findUnique({ where: { email: googleData.email } });

                if (user) {
                    // Link Google ID if not already linked
                    if (!user.googleId) {
                        user = await prisma.user.update({
                            where: { id: user.id },
                            data: { googleId: googleData.googleId }
                        });
                    }

                    console.log('[Google OAuth] Existing user found:', user.email);
                    return done(null, user);
                } else {
                    // New user - return Google data for registration
                    console.log('[Google OAuth] New user detected:', googleData.email);
                    return done(null, { isNewUser: true, googleData });
                }

            } catch (error) {
                console.error('[Google OAuth] Error:', error);
                return done(error, null);
            }
        }
    )
);

// Serialize user to session
passport.serializeUser((user, done) => {
    // If new user, serialize the googleData
    if (user.isNewUser) {
        done(null, { isNewUser: true, googleData: user.googleData });
    } else {
        // Existing user - serialize user ID
        done(null, user.id);
    }
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
    try {
        // If it's new user data, return as is
        if (typeof id === 'object' && id.isNewUser) {
            return done(null, id);
        }

        // Otherwise, fetch user from database
        const user = await prisma.user.findUnique({ where: { id } });
        done(null, user);
    } catch (error) {
        done(error, null);
    }
});

export default passport;

