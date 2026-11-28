import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./index.css";
import { setupAudio } from "@/engine/audioContext";
import { AuthGate } from "@/auth/auth";
import { Home } from "@/routes/Home";
import { RoomPage } from "@/routes/RoomPage";

setupAudio();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthGate>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/room/:id" element={<RoomPage />} />
        </Routes>
      </AuthGate>
    </BrowserRouter>
  </StrictMode>,
);
