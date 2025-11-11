import { NextRequest, NextResponse } from "next/server";
import { makePDFFromDomain } from "@/app/pdf";

// Adicionar headers CORS
const allowedOrigins = [
    'http://localhost:8000',
    'http://getoffice.vercel.app',
    'https://getoffice-notion-pdf-service.vercel.app'
];

function getCorsHeaders(origin: string | null) {
    const isAllowed = origin && allowedOrigins.includes(origin);
    
    return {
        'Access-Control-Allow-Origin': isAllowed ? origin : allowedOrigins[0],
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Credentials': 'true',
    };
}

export async function OPTIONS(request: NextRequest) {
    const origin = request.headers.get('origin');
    const corsHeaders = getCorsHeaders(origin);
    return NextResponse.json({}, { headers: corsHeaders });
}

export async function POST(request: NextRequest) {
    const origin = request.headers.get('origin');
    const corsHeaders = getCorsHeaders(origin);

    try {
        const body = await request.json();
        const { url } = body;

        if (!url || typeof url !== 'string') {
            return NextResponse.json(
                { error: 'URL é obrigatória' },
                { status: 400, headers: corsHeaders }
            );
        }

        try {
            new URL(url);
        } catch {
            return NextResponse.json(
                { error: 'URL inválida' },
                { status: 400, headers: corsHeaders }
            );
        }

        console.log(`[API] Generating PDF for URL: ${url}`);

        const pdfBuffer = await makePDFFromDomain(url);

        // Converter Buffer para Uint8Array (compatível com NextResponse)
        return new NextResponse(new Uint8Array(pdfBuffer), {
            status: 200,
            headers: {
                ...corsHeaders,
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="document.pdf"`,
            },
        });
    } catch (error) {
        console.error("[API] Error generating PDF:", error);
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Erro ao gerar PDF" },
            { status: 500, headers: corsHeaders }
        );
    }
}