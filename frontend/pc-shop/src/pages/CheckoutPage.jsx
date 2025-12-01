import { useState, useEffect, useContext, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import '../css/CheckoutPage.css';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import axios from '../services/axios';
import { AuthContext } from '../context/AuthContext';

/**
 * NOTE:
 * - pendingRequests (module scope) giữ key request đang chờ, tránh duplicate across re-renders.
 * - isSubmitting (ref) chặn ngay lập tức khi handler được gọi lần 2.
 * - stopImmediatePropagation bảo vệ nếu có nhiều handler được gắn; dùng e.nativeEvent.
 * - Button dùng onClick để kiểm soát trực tiếp, nhưng form.onSubmit vẫn xử lý Enter key.
 */

// Module-scope dedupe set (giữ across mounts)
const pendingRequests = new Set();

function makeRequestKey(url, data) {
  try {
    return url + '::' + JSON.stringify(data);
  } catch (e) {
    return url;
  }
}

const provinces = [
  "Hà Nội", "Hồ Chí Minh", "Đà Nẵng", "Hải Phòng", "Cần Thơ", "An Giang", "Bà Rịa - Vũng Tàu",
  "Bắc Giang", "Bắc Kạn", "Bạc Liêu", "Bắc Ninh", "Bến Tre", "Bình Định", "Bình Dương", "Bình Phước",
  "Bình Thuận", "Cà Mau", "Cao Bằng", "Đắk Lắk", "Đắk Nông", "Điện Biên", "Đồng Nai", "Đồng Tháp",
  "Gia Lai", "Hà Giang", "Hà Nam", "Hà Tĩnh", "Hải Dương", "Hậu Giang", "Hòa Bình", "Hưng Yên",
  "Khánh Hòa", "Kiên Giang", "Kon Tum", "Lai Châu", "Lâm Đồng", "Lạng Sơn", "Lào Cai", "Long An",
  "Nam Định", "Nghệ An", "Ninh Bình", "Ninh Thuận", "Phú Thọ", "Phú Yên", "Quảng Bình", "Quảng Nam",
  "Quảng Ngãi", "Quảng Ninh", "Quảng Trị", "Sóc Trăng", "Sơn La", "Tây Ninh", "Thái Bình", "Thái Nguyên",
  "Thanh Hóa", "Thừa Thiên Huế", "Tiền Giang", "Trà Vinh", "Tuyên Quang", "Vĩnh Long", "Vĩnh Phúc",
  "Yên Bái"
];

function CheckoutPage() {
  const { user } = useContext(AuthContext);
  const navigate = useNavigate();

  // trạng thái form
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    province: "",
    address: "",
    note: "",
    payment: "cod"
  });

  const [cart, setCart] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  // ref để chặn submit ngay lập tức
  const isSubmitting = useRef(false);

  // Khi VNPay redirect về, chỉ chạy 1 lần (dùng sessionStorage để tránh double handling)
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const code = query.get("vnp_ResponseCode");

    if (code === "00") {
      if (sessionStorage.getItem("vnp_returned")) return;
      sessionStorage.setItem("vnp_returned", "1");

      const cartKey = user ? `cart_${user.id}` : 'cart_guest';
      try { localStorage.removeItem(cartKey); } catch (e) { /* ignore */ }
      try { localStorage.removeItem('vnpay_pending'); } catch (e) {}
      localStorage.setItem("vnpay_success", "true");

      // Trigger update UI toàn site
      window.dispatchEvent(new Event("storage"));

      alert("🎉 Thanh toán thành công! Giỏ hàng đã được làm mới.");
      navigate('/cart');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // chỉ chạy 1 lần

  // Load cart cho người dùng hoặc guest
  useEffect(() => {
    const cartKey = user ? `cart_${user.id}` : 'cart_guest';
    const storedCart = JSON.parse(localStorage.getItem(cartKey)) || [];
    setCart(storedCart);
    setTotal(storedCart.reduce((sum, item) => sum + (item.price || 0) * (item.quantity || 0), 0));
  }, [user]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  // Core submit function (loại bỏ duplicate bằng nhiều lớp)
  const doSubmit = async (orderData, token) => {
    // chọn URL theo phương thức thanh toán
    const url = form.payment === "bank" ? '/orders/vnpay' : '/orders';
    const reqKey = makeRequestKey(url, orderData);

    // Dedupe: nếu đã có request cùng key đang chờ thì block
    if (pendingRequests.has(reqKey)) {
      console.warn("Duplicate request blocked:", reqKey);
      throw new Error("duplicate_request_blocked");
    }
    pendingRequests.add(reqKey);

    try {
      if (form.payment === "cod") {
        const res = await axios.post('/orders', orderData, {
          headers: { Authorization: `Bearer ${token}` }
        });
        return res;
      } else {
        const res = await axios.post('/orders/vnpay', orderData, {
          headers: { Authorization: `Bearer ${token}` }
        });
        return res;
      }
    } finally {
      // remove key trong finally? Nếu redirect diễn ra, finally có thể không chạy.
      // Tuy nhiên trong environment bình thường, ta xóa sau khi response hoặc lỗi.
      pendingRequests.delete(reqKey);
    }
  };

  // Handler dùng cho cả form.onSubmit và button.onClick
  const handleSubmit = async (e) => {
    if (e) {
      // nếu gọi từ form submit, prevent default
      if (typeof e.preventDefault === 'function') e.preventDefault();
      // stop các handler khác trên cùng event (nếu có)
      if (e?.nativeEvent?.stopImmediatePropagation) {
        e.nativeEvent.stopImmediatePropagation();
      }
    }

    console.trace("handleSubmit called", { time: Date.now(), payment: form.payment });

    // guard 1: ref immediate
    if (isSubmitting.current) {
      console.log("Blocked by isSubmitting ref");
      return;
    }

    // guard 2: loading state
    if (loading) {
      console.log("Blocked by loading state");
      return;
    }

    // lock immediately
    isSubmitting.current = true;
    setLoading(true);

    const token = localStorage.getItem('token');
    if (!token) {
      alert("❌ Vui lòng đăng nhập để đặt hàng!");
      setLoading(false);
      isSubmitting.current = false;
      return;
    }

    // prepare payload
    const orderData = {
      items: cart.map(item => ({
        productId: item._id,
        quantity: item.quantity
      })),
      total,
      ...form
    };

    try {
      const res = await doSubmit(orderData, token);

      // Nếu COD
      if (form.payment === "cod") {
        alert("🎉 Đặt hàng thành công!");
        const cartKey = user ? `cart_${user.id}` : 'cart_guest';
        try { localStorage.removeItem(cartKey); } catch (e) {}
        setCart([]);
        window.dispatchEvent(new Event("storage"));

        // reset trạng thái trước khi navigate
        setLoading(false);
        isSubmitting.current = false;
        navigate('/');
        return;
      }

      // Nếu VNPay
      if (form.payment === "bank") {
        if (res?.data?.paymentUrl) {
          try {
            localStorage.setItem('vnpay_pending', JSON.stringify({
              orderData: res.data.orderData,
              txnRef: res.data.txnRef
            }));
          } catch (e) { console.warn("Không thể lưu vnpay_pending", e); }

          console.log("Redirecting to VNPay:", res.data.paymentUrl);
          // redirect — đặt return ngay sau để tránh chạy tiếp
          window.location.href = res.data.paymentUrl;
          return;
        } else {
          throw new Error("Không nhận được paymentUrl từ server");
        }
      }

    } catch (err) {
      // Nếu bị block duplicate, để console log rõ ràng
      if (err?.message === 'duplicate_request_blocked') {
        console.warn("Request duplicate was blocked by client dedupe.");
      } else {
        console.error("Lỗi khi đặt hàng:", err?.response?.data || err.message || err);
        alert("❌ Đặt hàng thất bại! Vui lòng thử lại.");
      }
    } finally {
      // reset (nếu đã redirect, phần này thường không chạy)
      setLoading(false);
      isSubmitting.current = false;
    }
  };

  return (
    <div>
      <Navbar />
      <div className="checkout-page" aria-busy={loading}>
        <h2>Thông tin thanh toán</h2>

        {/* Giỏ hàng */}
        <div style={{ marginBottom: 24, background: "#f7f7fa", borderRadius: 8, padding: 16 }}>
          <h3 style={{ marginBottom: 12 }}>Sản phẩm trong đơn hàng</h3>

          {cart.length === 0 ? (
            <p>Không có sản phẩm nào trong giỏ hàng.</p>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
              {cart.map(item => (
                <li key={item._id} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                  <img src={item.image} alt={item.name} style={{ width: 48, height: 48, objectFit: "cover", borderRadius: 6 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 500 }}>{item.name}</div>
                    <div style={{ fontSize: "0.9rem", color: "#666" }}>x{item.quantity}</div>
                  </div>
                  <div style={{ fontWeight: 600, color: "#2d6a4f" }}>
                    {(item.price * item.quantity).toLocaleString()} VND
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div style={{ borderTop: "1px solid #e0e0e0", marginTop: 12, paddingTop: 10, textAlign: "right" }}>
            <div style={{ fontSize: "1rem", marginBottom: 4 }}>
              Tổng tạm tính: <b>{total.toLocaleString()} VND</b>
            </div>
            <div style={{ fontSize: "1.08rem", fontWeight: 600, color: "#1976d2" }}>
              Thành tiền: {total.toLocaleString()} VND
            </div>
          </div>
        </div>

        {/* Form thanh toán */}
        <form onSubmit={handleSubmit}>
          <input
            name="name"
            placeholder="Họ tên"
            value={form.name}
            onChange={handleChange}
            required
            disabled={loading}
          />
          <input
            name="email"
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={handleChange}
            required
            disabled={loading}
          />
          <input
            name="phone"
            type="tel"
            placeholder="Số điện thoại"
            value={form.phone}
            onChange={handleChange}
            required
            disabled={loading}
          />
          <select
            name="province"
            value={form.province}
            onChange={handleChange}
            required
            disabled={loading}
          >
            <option value="">Chọn tỉnh/thành phố</option>
            {provinces.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <input
            name="address"
            placeholder="Địa chỉ"
            value={form.address}
            onChange={handleChange}
            required
            disabled={loading}
          />
          <textarea
            name="note"
            placeholder="Ghi chú (tuỳ chọn)"
            value={form.note}
            onChange={handleChange}
            rows={3}
            disabled={loading}
          />

          <div style={{ display: "flex", gap: 24, margin: "8px 0" }}>
            <label>
              <input
                type="radio"
                name="payment"
                value="cod"
                checked={form.payment === "cod"}
                onChange={handleChange}
                disabled={loading}
              />
              Thanh toán khi nhận hàng (COD)
            </label>
            <label>
              <input
                type="radio"
                name="payment"
                value="bank"
                checked={form.payment === "bank"}
                onChange={handleChange}
                disabled={loading}
              />
              Chuyển khoản (VNPay)
            </label>
          </div>

          {/* Dùng onClick để giảm rủi ro submit đôi từ browser; form.onSubmit vẫn xử lý Enter */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={loading}
            aria-disabled={loading}
          >
            {loading ? "Đang xử lý..." : "Đặt hàng"}
          </button>
        </form>
      </div>
      <Footer />
    </div>
  );
}

export default CheckoutPage;
