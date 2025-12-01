import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import '../css/PaymentReturn.css';

const PaymentReturn = () => {
  const navigate = useNavigate();
  const [status, setStatus] = useState("loading");
  const [message, setMessage] = useState("Đang xác minh giao dịch...");
  const [orderId, setOrderId] = useState(null);

  useEffect(() => {
    const LOCK_KEY = "vnp_confirm_called";

    // Nếu đã xử lý trong session này -> bỏ qua
    if (sessionStorage.getItem(LOCK_KEY)) {
      console.log("PaymentReturn: already handled in this session, skipping.");
      setStatus("success");
      setMessage("Giao dịch đã được xử lý trước đó. Đang chuyển về trang chủ...");
      setTimeout(() => navigate("/"), 2000);
      return;
    }

    // Khóa ngay để ngăn double handling khi component double-mount (StrictMode)
    sessionStorage.setItem(LOCK_KEY, "1");

    const verifyPayment = async () => {
      try {
        const pendingOrderRaw = localStorage.getItem("vnpay_pending");
        if (!pendingOrderRaw) {
          setStatus("error");
          setMessage("Không tìm thấy thông tin đơn hàng.");
          // clear lock để người dùng có thể thử lại nếu cần
          sessionStorage.removeItem(LOCK_KEY);
          setTimeout(() => navigate("/"), 2500);
          return;
        }

        const pendingOrder = JSON.parse(pendingOrderRaw);
        const queryString = window.location.search;
        const vnp_Params = Object.fromEntries(new URLSearchParams(queryString).entries());

        const vnp_ResponseCode = vnp_Params.vnp_ResponseCode;
        const vnp_TxnRef = vnp_Params.vnp_TxnRef;

        if (!vnp_ResponseCode || !vnp_TxnRef) {
          setStatus("error");
          setMessage("Thiếu thông tin thanh toán.");
          sessionStorage.removeItem(LOCK_KEY);
          setTimeout(() => navigate("/"), 2500);
          return;
        }

        setOrderId(vnp_TxnRef);

        // Gọi API xác minh (không abort)
        const response = await axios.post(
          "https://devops-api1-2.onrender.com/api/orders/vnpay/confirm", // dùng đường dẫn tương đối nếu bạn có proxy; nếu không, đổi về full URL
          {
            orderData: pendingOrder.orderData,
            vnp_Params,
          },
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem("token")}`,
            },
          }
        );

        // Xử lý kết quả
        if (response?.data?.success && vnp_ResponseCode === "00") {
          setStatus("success");
          setMessage("Thanh toán thành công!");
          // xoá pending và cart
          try { localStorage.removeItem("vnpay_pending"); } catch (e) {}
          const user = JSON.parse(localStorage.getItem("userInfo"));
          if (user) {
            try { localStorage.removeItem(`cart_${user.id}`); } catch (e) {}
          } else {
            try { localStorage.removeItem("cart_guest"); } catch (e) {}
          }
          try { localStorage.setItem("vnpay_success", "true"); } catch (e) {}
          // cập nhật UI toàn site
          window.dispatchEvent(new Event("storage"));

          // chuyển về sau 800ms để đảm bảo request hoàn tất và UX mượt
          setTimeout(() => {
            sessionStorage.removeItem(LOCK_KEY);
            navigate("/");
          }, 800);
        } else {
          setStatus("error");
          setMessage(response?.data?.message || "Thanh toán thất bại.");
          // cho phép thử lại sau khi báo lỗi
          sessionStorage.removeItem(LOCK_KEY);
          setTimeout(() => navigate("/"), 2500);
        }
      } catch (err) {
        console.error("💥 Lỗi xác minh thanh toán:", err);
        setStatus("error");
        setMessage("Lỗi kết nối. Vui lòng thử lại.");
        sessionStorage.removeItem(LOCK_KEY);
        setTimeout(() => navigate("/"), 2500);
      }
    };

    verifyPayment();

    // Không dùng cleanup abort: muốn request hoàn thành dù component unmount
    // return () => { /* nothing */ };
  }, [navigate]);

  return (
    <div className="payment-return-container">
      <div className="payment-return-card">
        {status === "loading" && (
          <>
            <div className="payment-return-spin"></div>
            <h2 className="payment-return-title">{message}</h2>
          </>
        )}

        {status === "success" && (
          <>
            <img
              src="https://cdn-icons-png.flaticon.com/512/845/845646.png"
              alt="Success"
              className="payment-return-success-img"
            />
            <h2 className="payment-return-title payment-return-success-title">
              Thanh toán thành công!
            </h2>
            <p className="payment-return-message">Mã giao dịch: {orderId}</p>
            <p className="payment-return-message">Cảm ơn bạn đã mua hàng</p>
          </>
        )}

        {status === "error" && (
          <>
            <img
              src="https://cdn-icons-png.flaticon.com/512/463/463612.png"
              alt="Error"
              className="payment-return-error-img"
            />
            <h2 className="payment-return-title payment-return-error-title">{message}</h2>
            {orderId && <p className="payment-return-message">Mã giao dịch: {orderId}</p>}
          </>
        )}

        <p className="payment-return-footer">Đang chuyển về trang chủ...</p>
      </div>
    </div>
  );
};

export default PaymentReturn;
