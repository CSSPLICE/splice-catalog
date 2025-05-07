import axios from 'axios';

export interface LTIValidationResponse {
  launchable: boolean;
  status_code?: number;
  launch_url?: string;
  error?: string;
}

export async function validateLTI(payload: object): Promise<LTIValidationResponse> {
  try {
    const response = await axios.post('http://lti-validator:4000/validate', payload);
    return response.data;
  } catch (error: any) {
    const message = error?.response?.data?.error || error.message || 'Unknown error';
    console.error("LTI validation failed:", message);
    return {
      launchable: false,
      error: message
    };
  }
}

