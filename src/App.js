import React, { useEffect, useRef, useState } from "react";
import "./App.css";

function App() {
  const [localStream, setLocalStream] = useState(null);
  // const [remoteStream, setRemoteStream] = useState(null);
  const [peerConnection, setPeerConnection] = useState(null);
  const [roomId, setRoomId] = useState("");
  const [joinRoomId, setJoinRoomId] = useState("");
  const [connectionStatus, setConnectionStatus] = useState("Disconnected");
  const [errorMessage, setErrorMessage] = useState("");
  const [copied, setCopied] = useState(false);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  // STUN servers for NAT traversal
  const iceServers = {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
    ],
  };

  useEffect(() => {
    let stream;

    async function setupLocalStream() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        setLocalStream(stream);
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = stream;
        }
      } catch (err) {
        setErrorMessage(`Error accessing camera/microphone: ${err.message}`);
        console.error("Error accessing media devices:", err);
      }
    }

    setupLocalStream();

    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  // Setup the peer connection when creating a room
  const createRoom = async () => {
    try {
      const pc = new RTCPeerConnection(iceServers);

      // Add local stream tracks to peer connection
      if (localStream) {
        localStream.getTracks().forEach((track) => {
          pc.addTrack(track, localStream);
        });
      }

      // Listen for remote stream
      pc.ontrack = (event) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
      };

      // Create offer
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Generate a random room ID
      const generatedRoomId = Math.random().toString(36).substring(2, 7);
      setRoomId(generatedRoomId);

      // In a real app, you'd send this offer to a signaling server
      // For this simple demo, we'll use local storage as a mock signaling mechanism
      localStorage.setItem(
        `offer_${generatedRoomId}`,
        JSON.stringify(pc.localDescription)
      );

      setPeerConnection(pc);
      setConnectionStatus("Waiting for peer to join...");

      // Setup ICE handling
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const currentCandidates = JSON.parse(
            localStorage.getItem(`ice_${generatedRoomId}`) || "[]"
          );
          currentCandidates.push(event.candidate);
          localStorage.setItem(
            `ice_${generatedRoomId}`,
            JSON.stringify(currentCandidates)
          );
        }
      };

      // Poll for answer
      const checkForAnswer = setInterval(async () => {
        const answerString = localStorage.getItem(`answer_${generatedRoomId}`);
        if (answerString) {
          const answer = JSON.parse(answerString);
          await pc.setRemoteDescription(new RTCSessionDescription(answer));
          clearInterval(checkForAnswer);
          setConnectionStatus("Connected!");

          // Poll for ICE candidates from the other peer
          const pollForCandidates = setInterval(() => {
            const remoteCandidatesString = localStorage.getItem(
              `ice_join_${generatedRoomId}`
            );
            if (remoteCandidatesString) {
              const remoteCandidates = JSON.parse(remoteCandidatesString);
              remoteCandidates.forEach(async (candidate) => {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
              });
              localStorage.removeItem(`ice_join_${generatedRoomId}`);
            }
          }, 1000);

          // Clear the polling after 30 seconds
          setTimeout(() => clearInterval(pollForCandidates), 30000);
        }
      }, 1000);

      // Clear the interval after 5 minutes if no answer
      setTimeout(() => {
        clearInterval(checkForAnswer);
        if (pc.connectionState !== "connected") {
          setConnectionStatus("No answer received. Try again.");
        }
      }, 300000);
    } catch (err) {
      setErrorMessage(`Error creating room: ${err.message}`);
      console.error("Error creating room:", err);
    }
  };

  // Join an existing room
  const joinRoom = async () => {
    if (!joinRoomId) {
      setErrorMessage("Please enter a Room ID");
      return;
    }

    try {
      const offerString = localStorage.getItem(`offer_${joinRoomId}`);
      if (!offerString) {
        setErrorMessage("Room not found");
        return;
      }

      const pc = new RTCPeerConnection(iceServers);

      // Add local stream tracks to peer connection
      if (localStream) {
        localStream.getTracks().forEach((track) => {
          pc.addTrack(track, localStream);
        });
      }

      // Listen for remote stream
      pc.ontrack = (event) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
      };

      // Set the remote description from the offer
      const offer = JSON.parse(offerString);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      // Get ICE candidates from creator
      const creatorCandidatesString = localStorage.getItem(`ice_${joinRoomId}`);
      if (creatorCandidatesString) {
        const creatorCandidates = JSON.parse(creatorCandidatesString);
        for (const candidate of creatorCandidates) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
      }

      // Create answer
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      // Send answer back
      localStorage.setItem(
        `answer_${joinRoomId}`,
        JSON.stringify(pc.localDescription)
      );

      setPeerConnection(pc);
      setRoomId(joinRoomId);
      setConnectionStatus("Connected!");

      // Handle ICE candidates
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          const currentCandidates = JSON.parse(
            localStorage.getItem(`ice_join_${joinRoomId}`) || "[]"
          );
          currentCandidates.push(event.candidate);
          localStorage.setItem(
            `ice_join_${joinRoomId}`,
            JSON.stringify(currentCandidates)
          );
        }
      };
    } catch (err) {
      setErrorMessage(`Error joining room: ${err.message}`);
      console.error("Error joining room:", err);
    }
  };

  const copyRoomId = () => {
    navigator.clipboard.writeText(roomId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const hangUp = () => {
    if (peerConnection) {
      peerConnection.close();
      setPeerConnection(null);
    }
    setConnectionStatus("Disconnected");

    // Clean up localStorage items
    if (roomId) {
      localStorage.removeItem(`offer_${roomId}`);
      localStorage.removeItem(`answer_${roomId}`);
      localStorage.removeItem(`ice_${roomId}`);
      localStorage.removeItem(`ice_join_${roomId}`);
    }
  };

  return (
    <div className="app">
      <h1>Simple WebRTC Video Call</h1>

      <div className="status">
        <p>Status: {connectionStatus}</p>
        {errorMessage && <p className="error">{errorMessage}</p>}
      </div>

      <div className="video-container">
        <div className="video-wrapper">
          <video
            ref={localVideoRef}
            autoPlay
            muted
            playsInline
            className="video-player"
          ></video>
          <p>Your Camera</p>
        </div>

        <div className="video-wrapper">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="video-player"
          ></video>
          <p>Remote Camera</p>
        </div>
      </div>

      <div className="controls">
        {!peerConnection ? (
          <>
            <div className="control-group">
              <button onClick={createRoom} disabled={!localStream}>
                Create Room
              </button>
            </div>
            <div className="control-group">
              <input
                type="text"
                value={joinRoomId}
                onChange={(e) => setJoinRoomId(e.target.value)}
                placeholder="Enter Room ID"
              />
              <button onClick={joinRoom} disabled={!localStream || !joinRoomId}>
                Join Room
              </button>
            </div>
          </>
        ) : (
          <div className="control-group">
            <button onClick={hangUp} className="hangup">
              Hang Up
            </button>
          </div>
        )}
      </div>

      {roomId && (
        <div className="room-info">
          <p>
            Room ID: <span className="room-id">{roomId}</span>
          </p>
          <button onClick={copyRoomId} className="copy-btn">
            {copied ? "Copied!" : "Copy Room ID"}
          </button>
          <p className="share-text">
            Share this ID with your friend to connect
          </p>
        </div>
      )}

      <footer>
        <p>
          Note: This is a simple demo using localStorage as a signaling method.
        </p>
        <p>For real-world use, you would need a proper signaling server.</p>
      </footer>
    </div>
  );
}

export default App;
