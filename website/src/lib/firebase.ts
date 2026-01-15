// Import the functions you need from the SDKs you need
import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import { getAnalytics, Analytics } from "firebase/analytics";

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyCNO1lEYoC_7T8hN2zfPxCaHAYGA6Mh-Ac",
  authDomain: "project-99796174811683966.firebaseapp.com",
  projectId: "project-99796174811683966",
  storageBucket: "project-99796174811683966.firebasestorage.app",
  messagingSenderId: "944294792573",
  appId: "1:944294792573:web:dcd012dca8d74e76f65014",
  measurementId: "G-CHTFYWR6JG",
};

// Initialize Firebase
let app: FirebaseApp;
if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}

// Initialize Analytics (only on client side)
let analytics: Analytics | null = null;
if (typeof window !== "undefined") {
  analytics = getAnalytics(app);
}

export { app, analytics };

