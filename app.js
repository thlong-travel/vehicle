import { GoogleGenerativeAI } from "@google/generative-ai";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc, serverTimestamp, query, where, orderBy, limit, getDocs } from "firebase/firestore";

// ==========================================
// 1. CẤU HÌNH API KEYS (Cần điền thông tin thật của anh)
// ==========================================
const GEMINI_API_KEY = "AIzaSyCcA6BxhiMPJfJ_G3OLg0cs7zJ_afPELG8";

const firebaseConfig = {
  apiKey: "AIzaSyBkiFF_f1PexwftBRdMwZrUCUj6cC4w_GA",
  authDomain: "thlong-vehicle-cost.firebaseapp.com",
  projectId: "thlong-vehicle-cost",
  storageBucket: "thlong-vehicle-cost.firebasestorage.app",
  messagingSenderId: "171162332982",
  appId: "1:171162332982:web:585cfd60679ef179fbcd97"
};

// Khởi tạo các dịch vụ
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

// Khởi tạo biến toàn cục cho Biểu đồ
let chartInstance = null;

// ==========================================
// 2. LOGIC AI - ĐỌC ẢNH CÔNG TƠ MÉT
// ==========================================
document.getElementById('btnReadImage').addEventListener('click', async () => {
    const fileInput = document.getElementById('odometerImage');
    const statusText = document.getElementById('aiStatus');
    const odometerInput = document.getElementById('odometerValue');

    if (fileInput.files.length === 0) {
        alert("Anh vui lòng chụp hoặc chọn ảnh Odometer trước nhé!");
        return;
    }

    statusText.innerText = "⏳ Đang gửi ảnh cho Gemini xử lý...";
    const file = fileInput.files[0];

    try {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = async () => {
            const base64Data = reader.result.split(',')[1];
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            
            const prompt = "Đây là ảnh chụp đồng hồ công-tơ-mét. Hãy trích xuất con số chỉ quãng đường (odometer). CHỈ TRẢ VỀ CÁC CHỮ SỐ, KHÔNG KÈM CHỮ CÁI, KHÔNG DẤU CHẤM PHẨY. Nếu mờ không đọc được, trả về ERROR.";
            
            const imagePart = { inlineData: { data: base64Data, mimeType: file.type } };
            const result = await model.generateContent([prompt, imagePart]);
            const textResult = result.response.text().trim();

            if (textResult === "ERROR" || isNaN(textResult) || textResult === "") {
                statusText.innerText = "❌ Ảnh mờ hoặc AI không nhận diện được. Anh vui lòng nhập tay.";
                statusText.className = "form-text text-danger mt-1 fw-bold";
            } else {
                odometerInput.value = textResult;
                statusText.innerText = "✅ Đã đọc thành công!";
                statusText.className = "form-text text-success mt-1 fw-bold";
            }
        };
    } catch (error) {
        console.error("Lỗi AI:", error);
        statusText.innerText = "❌ Lỗi kết nối AI.";
    }
});

// ==========================================
// 3. LOGIC TRUY VẤN VÀ LƯU DỮ LIỆU FIRESTORE
// ==========================================
async function getLastFullFill(vehicleId) {
    const expensesRef = collection(db, "expenses");
    const q = query(
        expensesRef,
        where("vehicle_id", "==", vehicleId),
        where("type", "==", "Xăng"),
        where("is_full", "==", true),
        orderBy("created_at", "desc"),
        limit(1)
    );

    // Lưu ý: Lần đầu chạy hàm này, Firebase Console sẽ báo lỗi thiếu Index.
    // Anh nhấn vào link trong console (F12) để tạo Index nhé.
    try {
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
            return snapshot.docs[0].data();
        }
    } catch (e) {
        console.error("Lỗi query (có thể do chưa tạo Index):", e);
    }
    return null; 
}

document.getElementById('btnSave').addEventListener('click', async () => {
    const btn = document.getElementById('btnSave');
    const vehicleId = document.getElementById('vehicleId').value;
    const type = document.getElementById('expenseType').value;
    const amount = Number(document.getElementById('amount').value);
    const isFull = document.getElementById('isFull').checked;
    const currentOdometer = Number(document.getElementById('odometerValue').value);

    if (!amount || !currentOdometer) {
        alert("Vui lòng nhập đủ Số tiền và Số Odometer!");
        return;
    }

    btn.disabled = true;
    btn.innerText = "⏳ Đang tính toán và lưu...";

    let costPerKm = 0; // VNĐ / Km
    let alertMessage = "✅ Đã lưu dữ liệu thành công!";

    // Tính toán hao phí nếu lần này đổ xăng đầy bình
    if (type === "Xăng" && isFull) {
        const lastFullFill = await getLastFullFill(vehicleId);
        
        if (lastFullFill && lastFullFill.odometer) {
            const distance = currentOdometer - lastFullFill.odometer;
            
            if (distance > 0) {
                costPerKm = Math.round(amount / distance);
                const averageCost = 500; // Mức chuẩn giả định (500đ/km)
                
                if (costPerKm > averageCost * 1.2) {
                    alertMessage = `⚠️ CẢNH BÁO HAO XĂNG!\nChi phí lần này: ${costPerKm} VNĐ/Km.\nAnh nên kiểm tra lại lốp hoặc bảo dưỡng xe nhé!`;
                } else {
                    alertMessage = `✅ Xe chạy ổn định!\nChi phí đợt này: ${costPerKm} VNĐ/Km.`;
                }
            } else {
                alertMessage = "Lưu thành công (Odometer hiện tại nhỏ hơn hoặc bằng lần trước, không thể tính hao phí).";
            }
        } else {
            alertMessage = "Lưu thành công! Đây là lần đổ đầy bình đầu tiên, hệ thống sẽ dùng mốc này để tính toán cho lần sau.";
        }
    }

    // Gói dữ liệu
    const dataToSave = {
        vehicle_id: vehicleId,
        type: type,
        amount: amount,
        odometer: currentOdometer,
        is_full: isFull,
        cost_per_km: costPerKm, // Lưu luôn biến này để vẽ biểu đồ cho dễ
        created_at: serverTimestamp()
    };

    try {
        await addDoc(collection(db, "expenses"), dataToSave);
        alert(alertMessage);
        
        // Reset form
        document.getElementById('amount').value = '';
        document.getElementById('odometerValue').value = '';
        document.getElementById('odometerImage').value = '';
        document.getElementById('isFull').checked = false;
        document.getElementById('aiStatus').innerText = '';
        
        // Load lại biểu đồ
        loadChart(vehicleId);
    } catch (error) {
        console.error("Lỗi lưu DB:", error);
        alert("Lỗi khi lưu dữ liệu! Kiểm tra Console F12.");
    } finally {
        btn.disabled = false;
        btn.innerText = "💾 Lưu Dữ Liệu";
    }
});

// ==========================================
// 4. LOGIC VẼ BIỂU ĐỒ BẰNG CHART.JS
// ==========================================
async function loadChart(vehicleId) {
    const expensesRef = collection(db, "expenses");
    // Chỉ lấy những lần đổ xăng đầy bình và có tính được cost_per_km > 0
    const q = query(
        expensesRef,
        where("vehicle_id", "==", vehicleId),
        where("type", "==", "Xăng"),
        where("is_full", "==", true),
        where("cost_per_km", ">", 0),
        orderBy("cost_per_km"), // Firestore yêu cầu range filter và orderBy phải cùng trường đầu tiên
        orderBy("created_at", "asc") 
    );

    try {
        const snapshot = await getDocs(q);
        
        // Sắp xếp lại theo thời gian ở Client (do hạn chế index của Firestore)
        let chartData = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if(data.created_at) {
                chartData.push({
                    date: data.created_at.toDate().toLocaleDateString('vi-VN'),
                    cost: data.cost_per_km,
                    timestamp: data.created_at.toMillis()
                });
            }
        });
        
        // Sắp xếp tăng dần theo thời gian
        chartData.sort((a, b) => a.timestamp - b.timestamp);

        const labels = chartData.map(item => item.date);
        const dataPoints = chartData.map(item => item.cost);

        renderChart(labels, dataPoints, vehicleId);

    } catch (e) {
        console.log("Đang chờ Index Firestore cho biểu đồ hoặc chưa có dữ liệu hợp lệ.");
    }
}

function renderChart(labels, dataPoints, vehicleId) {
    const ctx = document.getElementById('expenseChart').getContext('2d');
    
    // Xóa biểu đồ cũ nếu đổi xe
    if (chartInstance) {
        chartInstance.destroy();
    }

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: `VNĐ/Km (${vehicleId})`,
                data: dataPoints,
                borderColor: 'rgb(75, 192, 192)',
                backgroundColor: 'rgba(75, 192, 192, 0.2)',
                tension: 0.3,
                fill: true,
                pointRadius: 5,
                pointHoverRadius: 8
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: false,
                    title: { display: true, text: 'VNĐ / Km' }
                }
            }
        }
    });
}

// Lắng nghe sự kiện đổi xe để cập nhật lại biểu đồ
document.getElementById('vehicleId').addEventListener('change', (e) => {
    loadChart(e.target.value);
});

// Load biểu đồ ngay khi mở web cho xe mặc định
loadChart(document.getElementById('vehicleId').value);
