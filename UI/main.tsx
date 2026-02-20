import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from '@tauri-apps/api/window';
import App from "./App";
import ProcessSelectorApp from "./ProcessSelectorApp";
import "./App.css";

const init = async () => {
  const label = getCurrentWindow().label;
  const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

  if (label === 'process-selector') {
    root.render(
      <React.StrictMode>
        <ProcessSelectorApp />
      </React.StrictMode>,
    );
  } else {
    // default to main App
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  }
};

init();
