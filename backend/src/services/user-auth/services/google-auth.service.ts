/**
 * Google Auth Service
 * Verifies a Google ID token (issued client-side by Google Sign-In) and
 * resolves/creates the associated user account.
 */

import { OAuth2Client } from 'google-auth-library';
import config from '../../../config';
import { User } from '../types';
import { InvalidGoogleTokenError } from '../errors';
import { findOrCreateUserForGoogle } from './user.service';

let client: OAuth2Client | null = null;

function getClient(): OAuth2Client {
  if (!client) {
    client = new OAuth2Client(config.auth.google.clientId);
  }
  return client;
}

export async function verifyGoogleIdToken(idToken: string): Promise<User> {
  if (!config.auth.google.clientId) {
    throw new Error('GOOGLE_CLIENT_ID is not configured');
  }

  let payload;
  try {
    const ticket = await getClient().verifyIdToken({
      idToken,
      audience: config.auth.google.clientId,
    });
    payload = ticket.getPayload();
  } catch {
    throw new InvalidGoogleTokenError();
  }

  if (!payload?.sub) {
    throw new InvalidGoogleTokenError();
  }

  return findOrCreateUserForGoogle(
    payload.sub,
    payload.email || null,
    payload.email_verified === true,
    payload.name || null,
    payload.picture || null
  );
}
