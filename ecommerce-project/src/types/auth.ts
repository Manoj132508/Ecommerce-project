export interface AuthUser {
  _id: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

export interface AuthResponse extends AuthUser {
  token: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterDetails extends LoginCredentials {
  name: string;
}
